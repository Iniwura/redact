/**
 * Zama relayer SDK helpers: initialization, input encryption, user decryption.
 *
 * The SDK does three jobs for us:
 *  1. encrypt feature values client-side into ciphertext handles + a ZK input proof
 *  2. user-decrypt: EIP-712 signed decryption of values the user has ACL rights to
 *  3. (pool flow) public-decrypt with a KMS proof for onchain verification
 */
import { initSDK, createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/web";
import type { WalletClient } from "viem";

// The instance is expensive to create (loads WASM + fetches FHE keys), so cache it.
let instancePromise: ReturnType<typeof createInstance> | null = null;

export async function getFheInstance() {
  if (!instancePromise) {
    instancePromise = (async () => {
      await initSDK();
      const eth = (window as unknown as { ethereum?: unknown }).ethereum;
      if (!eth) throw new Error("No injected wallet found. Install MetaMask.");
      return createInstance({ ...SepoliaConfig, network: eth });
    })() as ReturnType<typeof createInstance>;
  }
  return instancePromise;
}

/**
 * Encrypt the 8 feature values for submission to Redact.
 * Returns the ciphertext handles (bytes32[8]) and the input proof.
 */
export async function encryptFeatures(
  contractAddress: string,
  userAddress: string,
  features: number[],
): Promise<{ handles: `0x${string}`[]; inputProof: `0x${string}` }> {
  const instance = await getFheInstance();
  const input = instance.createEncryptedInput(contractAddress, userAddress);
  for (const f of features) {
    input.add32(f);
  }
  const enc = await input.encrypt();
  const toHex = (u8: Uint8Array): `0x${string}` =>
    ("0x" + Array.from(u8).map((b) => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
  return {
    handles: enc.handles.map(toHex),
    inputProof: toHex(enc.inputProof),
  };
}

/**
 * User-decrypt one or more ciphertext handles the connected wallet has ACL
 * rights to. Runs the full EIP-712 flow: generate an ephemeral keypair, have
 * the wallet sign a typed-data permission, call the relayer, decrypt locally.
 */
export async function userDecrypt(
  walletClient: WalletClient,
  userAddress: `0x${string}`,
  contractAddress: string,
  handles: string[],
): Promise<Record<string, bigint | boolean | string>> {
  const instance = await getFheInstance();

  const keypair = instance.generateKeypair();
  const handleContractPairs = handles.map((handle) => ({ handle, contractAddress }));
  const startTimeStamp = Math.floor(Date.now() / 1000);
  const durationDays = 7;
  const contractAddresses = [contractAddress];

  const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimeStamp, durationDays);

  const signature = await walletClient.signTypedData({
    account: userAddress,
    domain: eip712.domain as never,
    types: { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification } as never,
    primaryType: "UserDecryptRequestVerification",
    message: eip712.message as never,
  });

  const result = await instance.userDecrypt(
    handleContractPairs,
    keypair.privateKey,
    keypair.publicKey,
    signature.replace("0x", ""),
    contractAddresses,
    userAddress,
    startTimeStamp,
    durationDays,
  );

  return result as Record<string, bigint | boolean | string>;
}

/**
 * Public-decrypt a handle that a contract marked publicly decryptable, and
 * return the ABI-encoded clear values plus the KMS decryption proof, ready
 * to submit to RedactLendingPool.finalizeLoan for onchain verification.
 */
export async function publicDecryptWithProof(handle: string): Promise<{
  abiEncodedClearValues: `0x${string}`;
  decryptionProof: `0x${string}`;
  clearValue: boolean;
}> {
  const instance = await getFheInstance();
  const res = await instance.publicDecrypt([handle]);
  return {
    abiEncodedClearValues: res.abiEncodedClearValues as `0x${string}`,
    decryptionProof: res.decryptionProof as `0x${string}`,
    clearValue: Boolean(res.clearValues[handle]),
  };
}
