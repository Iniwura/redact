import { useEffect, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { decodeEventLog } from "viem";

const ZERO_HANDLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
import {
  REDACT_ADDRESS,
  POOL_ADDRESS,
  USDC_ADDRESS,
  REDACT_ABI,
  POOL_ABI,
  ERC20_ABI,
  FEATURES,
  TIER_INFO,
} from "./contracts";
import { encryptFeatures, userDecrypt, publicDecryptWithProof } from "./fhe";

type Phase = "form" | "encrypting" | "submitting" | "submitted" | "decrypting" | "revealed";

type Verdict = { approved: boolean; score: bigint; tier: number } | null;

type LoanInfo = { principal: bigint; amountDue: bigint; dueAt: bigint; tier: number } | null;

export default function App() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [values, setValues] = useState<number[]>(FEATURES.map((f) => f.default));
  const [attested, setAttested] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [status, setStatus] = useState("");
  const [txHash, setTxHash] = useState("");
  const [loanStatus, setLoanStatus] = useState("");
  const [loan, setLoan] = useState<LoanInfo>(null);
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [error, setError] = useState("");

  // Attest the onchain-activity feature straight from Sepolia: transaction count,
  // capped to the feature range. The user cannot edit this one.
  useEffect(() => {
    (async () => {
      if (!address || !publicClient) return;
      try {
        const txCount = await publicClient.getTransactionCount({ address });
        const activity = Math.min(txCount, 200);
        setValues((prev) => {
          const next = [...prev];
          next[7] = activity;
          return next;
        });
        setAttested(true);
      } catch {
        setAttested(false);
      }
    })();
  }, [address, publicClient]);

  async function refreshBalance() {
    if (!address || !publicClient) return;
    const bal = (await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address],
    })) as bigint;
    setUsdcBalance(bal);
  }

  // Wait for a tx and REQUIRE it to have succeeded. A receipt alone is not
  // success: reverted transactions also produce receipts.
  async function mustSucceed(hash: `0x${string}`, what: string) {
    const receipt = await publicClient!.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`${what} reverted onchain (tx ${hash.slice(0, 10)}...). See Etherscan for the revert reason.`);
    }
    return receipt;
  }

  async function handleFaucet() {
    if (!address || !walletClient || !publicClient) return;
    setError("");
    try {
      const hash = await walletClient.writeContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "mint",
        args: [address, 100_000000n], // 100 rUSDC
        account: address,
        chain: walletClient.chain,
      });
      await mustSucceed(hash, "Faucet mint");
      await refreshBalance();
    } catch (e) {
      console.error(e);
      setError(shortErr(e));
    }
  }

  useEffect(() => {
    refreshBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, publicClient]);

  const setValue = (i: number, v: number) => {
    if (FEATURES[i].attested) return;
    const next = [...values];
    next[i] = v;
    setValues(next);
  };

  async function handleSubmit() {
    if (!address || !walletClient || !publicClient) return;
    setError("");
    try {
      setPhase("encrypting");
      setStatus("Encrypting your data locally. It never leaves your machine in the clear.");
      const { handles, inputProof } = await encryptFeatures(REDACT_ADDRESS, address, values);

      setPhase("submitting");
      setStatus("Submitting ciphertexts onchain. The AI scores you without seeing you.");
      const hash = await walletClient.writeContract({
        address: REDACT_ADDRESS,
        abi: REDACT_ABI,
        functionName: "submitApplication",
        args: [handles as never, inputProof],
        account: address,
        chain: walletClient.chain,
      });
      setTxHash(hash);
      await mustSucceed(hash, "Application submission");

      setPhase("submitted");
      setStatus("Scored under FHE. Only you can unmask the result.");
    } catch (e) {
      console.error(e);
      setError(shortErr(e));
      setPhase("form");
    }
  }

  async function handleReveal() {
    if (!address || !walletClient || !publicClient) return;
    setError("");
    try {
      setPhase("decrypting");
      setStatus("Sign the message to prove you are the applicant.");

      const [verdictHandle, scoreHandle, tierHandle] = await Promise.all([
        publicClient.readContract({ address: REDACT_ADDRESS, abi: REDACT_ABI, functionName: "getMyVerdict", account: address }),
        publicClient.readContract({ address: REDACT_ADDRESS, abi: REDACT_ABI, functionName: "getMyScore", account: address }),
        publicClient.readContract({ address: REDACT_ADDRESS, abi: REDACT_ABI, functionName: "getMyTier", account: address }),
      ]);

      const result = await userDecrypt(walletClient, address, REDACT_ADDRESS, [
        verdictHandle as string,
        scoreHandle as string,
        tierHandle as string,
      ]);

      const approved = Boolean(result[verdictHandle as string]);
      const score = BigInt(result[scoreHandle as string] as bigint);
      const tier = Number(result[tierHandle as string]);
      setVerdict({ approved, score, tier });
      setPhase("revealed");
      setStatus("");
    } catch (e) {
      console.error(e);
      setError(shortErr(e));
      setPhase("submitted");
    }
  }

  async function handleLoanFlow() {
    if (!address || !walletClient || !publicClient) return;
    setError("");
    try {
      setLoanStatus("1/4 Authorizing the pool to read your tier (never your score or data)...");
      const authHash = await walletClient.writeContract({
        address: REDACT_ADDRESS,
        abi: REDACT_ABI,
        functionName: "authorizeLender",
        args: [POOL_ADDRESS],
        account: address,
        chain: walletClient.chain,
      });
      await mustSucceed(authHash, "Lender authorization");

      // Resume a pending request if one exists (e.g. from an interrupted run),
      // otherwise create a new one and take the tier handle straight from the
      // LoanRequested event in the receipt. Never rely on a post-tx state read.
      let tierHandle: string | null = null;

      const existing = (await publicClient.readContract({
        address: POOL_ADDRESS,
        abi: POOL_ABI,
        functionName: "pending",
        args: [address],
      })) as readonly [bigint, string, boolean];

      if (existing[2] && existing[1] !== ZERO_HANDLE) {
        setLoanStatus("2/4 Resuming your pending loan request...");
        tierHandle = existing[1];
      } else {
        setLoanStatus("2/4 Requesting a loan priced by your confidential tier...");
        const reqHash = await walletClient.writeContract({
          address: POOL_ADDRESS,
          abi: POOL_ABI,
          functionName: "requestLoan",
          args: [],
          account: address,
          chain: walletClient.chain,
        });
        const receipt = await mustSucceed(reqHash, "Loan request");
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({ abi: POOL_ABI, data: log.data, topics: log.topics });
            if (decoded.eventName === "LoanRequested") {
              tierHandle = (decoded.args as { tierHandle: string }).tierHandle;
              break;
            }
          } catch {
            // not our event, skip
          }
        }
      }

      // Last-resort fallback: poll the pending record until the node catches up.
      if (!tierHandle || tierHandle === ZERO_HANDLE) {
        for (let i = 0; i < 5 && (!tierHandle || tierHandle === ZERO_HANDLE); i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const p = (await publicClient.readContract({
            address: POOL_ADDRESS,
            abi: POOL_ABI,
            functionName: "pending",
            args: [address],
          })) as readonly [bigint, string, boolean];
          if (p[2]) tierHandle = p[1];
        }
      }

      if (!tierHandle || tierHandle === ZERO_HANDLE) {
        throw new Error("Could not obtain the tier handle. Wait a few seconds and press the borrow button again.");
      }

      setLoanStatus("3/4 Fetching the KMS decryption proof for your tier...");
      const proof = await publicDecryptWithProof(tierHandle);

      setLoanStatus("4/4 Submitting the proof onchain. Forged tiers revert here.");
      const finHash = await walletClient.writeContract({
        address: POOL_ADDRESS,
        abi: POOL_ABI,
        functionName: "finalizeLoan",
        args: [address, proof.abiEncodedClearValues, proof.decryptionProof],
        account: address,
        chain: walletClient.chain,
      });
      await mustSucceed(finHash, "Loan finalization");

      const l = (await publicClient.readContract({
        address: POOL_ADDRESS,
        abi: POOL_ABI,
        functionName: "loans",
        args: [address],
      })) as readonly [bigint, bigint, bigint, number, boolean];

      if (l[4]) {
        setLoan({ principal: l[0], amountDue: l[1], dueAt: l[2], tier: l[3] });
        setLoanStatus("Loan issued. Check your wallet: real rUSDC just arrived.");
      } else {
        setLoan(null);
        setLoanStatus("The pool rejected the loan based on your tier. Your data still never left encryption.");
      }
      await refreshBalance();
    } catch (e) {
      console.error(e);
      setError(shortErr(e));
      setLoanStatus("");
    }
  }

  async function handleRepay() {
    if (!address || !walletClient || !publicClient || !loan) return;
    setError("");
    try {
      const bal = (await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;
      if (bal < loan.amountDue) {
        const shortBy = Number(loan.amountDue - bal) / 1e6;
        throw new Error(
          `You are ${shortBy.toLocaleString()} rUSDC short of the ${Number(loan.amountDue) / 1e6} due (interest). Use the faucet button in the header, then repay.`,
        );
      }

      setLoanStatus("Approving repayment (principal + 5% interest)...");
      const approveHash = await walletClient.writeContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [POOL_ADDRESS, loan.amountDue],
        account: address,
        chain: walletClient.chain,
      });
      await mustSucceed(approveHash, "Repay approval");

      setLoanStatus("Repaying...");
      const repayHash = await walletClient.writeContract({
        address: POOL_ADDRESS,
        abi: POOL_ABI,
        functionName: "repay",
        args: [],
        account: address,
        chain: walletClient.chain,
      });
      await mustSucceed(repayHash, "Repayment");

      setLoan(null);
      setLoanStatus("Repaid in full. Credit line closed clean.");
      await refreshBalance();
    } catch (e) {
      console.error(e);
      setError(shortErr(e));
    }
  }

  function reset() {
    setPhase("form");
    setVerdict(null);
    setStatus("");
    setTxHash("");
    setLoanStatus("");
    setError("");
  }

  const busy = phase === "encrypting" || phase === "submitting" || phase === "decrypting";
  const tierInfo = verdict ? TIER_INFO[Math.min(verdict.tier, 3)] : null;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">R</span>
          <span className="brand-name">REDACT</span>
          <span className="brand-tag">confidential AI credit oracle</span>
        </div>
        <div className="topright">
          {usdcBalance !== null && (
            <span className="chip static mono">{(Number(usdcBalance) / 1e6).toLocaleString()} rUSDC</span>
          )}
          {isConnected && (
            <button className="chip faucet" onClick={handleFaucet} title="Mint 100 test rUSDC">
              + faucet
            </button>
          )}
          <ConnectButton showBalance={false} />
        </div>
      </header>

      <main className="main">
        <section className="hero">
          <h1>
            The AI scores you.
            <br />
            <span className="accent">Nobody reads you.</span>
          </h1>
          <p className="sub">
            A machine learning credit model running fully homomorphically encrypted on Ethereum. Your financial data is
            encrypted on your device, scored while still encrypted, and priced into a risk tier that only you can
            unmask. Lenders see the tier. Never the score. Never the data.
          </p>
          <div className="chips">
            <a className="chip" href={`https://sepolia.etherscan.io/address/${REDACT_ADDRESS}#code`} target="_blank" rel="noreferrer">
              Oracle ↗
            </a>
            <a className="chip" href={`https://sepolia.etherscan.io/address/${POOL_ADDRESS}#code`} target="_blank" rel="noreferrer">
              Lending pool ↗
            </a>
            <a className="chip" href={`https://sepolia.etherscan.io/address/${USDC_ADDRESS}#code`} target="_blank" rel="noreferrer">
              rUSDC ↗
            </a>
            <span className="chip static">Sepolia · FHEVM by Zama</span>
          </div>
        </section>

        {!isConnected && (
          <section className="card center">
            <p className="muted">Connect a wallet on Sepolia to run a confidential credit check.</p>
          </section>
        )}

        {isConnected && (phase === "form" || busy) && (
          <section className="card">
            <h2>Your application</h2>
            <p className="muted">
              Self-reported values are encrypted in your browser before anything touches the chain. The onchain
              activity field is attested: read directly from Sepolia, not editable, not fakeable.
            </p>
            <div className="grid">
              {FEATURES.map((f, i) => (
                <div className="field" key={f.key}>
                  <label>
                    {f.label}{" "}
                    <span className="hint">({f.hint})</span>
                    {f.attested && <span className="attested-badge">{attested ? "ATTESTED" : "READING..."}</span>}
                  </label>
                  <div className="fieldrow">
                    <input
                      type="range"
                      min={f.min}
                      max={f.max}
                      value={values[i]}
                      disabled={busy || f.attested}
                      onChange={(e) => setValue(i, Number(e.target.value))}
                    />
                    <input
                      type="number"
                      className="num"
                      min={f.min}
                      max={f.max}
                      value={values[i]}
                      disabled={busy || f.attested}
                      onChange={(e) => setValue(i, Math.min(f.max, Math.max(f.min, Number(e.target.value) || 0)))}
                    />
                  </div>
                </div>
              ))}
            </div>
            <button className="cta" onClick={handleSubmit} disabled={busy}>
              {busy ? status : "Encrypt and submit"}
            </button>
            {busy && <div className="pulse" />}
          </section>
        )}

        {isConnected && (phase === "submitted" || phase === "decrypting" || phase === "revealed") && (
          <section className="card">
            <h2>Onchain record</h2>
            <p className="muted">This is everything the world can see about your application:</p>
            <div className="redactions">
              {FEATURES.map((f) => (
                <div className="redaction-row" key={f.key}>
                  <span className="redaction-label">{f.label}</span>
                  <span className="redaction-bar" aria-label="redacted" />
                </div>
              ))}
              <div className="redaction-row">
                <span className="redaction-label">Credit score</span>
                {phase === "revealed" && verdict ? (
                  <span className="revealed mono">{verdict.score.toString()}</span>
                ) : (
                  <span className="redaction-bar" />
                )}
              </div>
              <div className="redaction-row">
                <span className="redaction-label">Risk tier</span>
                {phase === "revealed" && verdict && tierInfo ? (
                  <span className={`verdict tier-${tierInfo.color}`}>{tierInfo.name}</span>
                ) : (
                  <span className="redaction-bar" />
                )}
              </div>
            </div>
            {txHash && (
              <a className="chip" href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer">
                Submission tx ↗
              </a>
            )}
            {phase !== "revealed" && (
              <button className="cta" onClick={handleReveal} disabled={phase === "decrypting"}>
                {phase === "decrypting" ? status : "Unmask my result (only you can)"}
              </button>
            )}
            {phase === "revealed" && verdict && tierInfo && (
              <>
                <p className="muted">
                  Decrypted with your signature alone. The feature bars stay black forever. That is not a UI choice, it
                  is cryptography.
                </p>
                {verdict.tier >= 1 && !loan && (
                  <div className="loanbox">
                    <h3>Your confidential credit line: {TIER_INFO[verdict.tier].loan.toLocaleString()} rUSDC</h3>
                    <p className="muted">
                      The pool prices your loan by tier without ever seeing your score. Terms: 5% interest, 30 days.
                    </p>
                    <button className="cta secondary" onClick={handleLoanFlow} disabled={!!loanStatus && !loan}>
                      {loanStatus && !loan ? loanStatus : `Borrow ${TIER_INFO[verdict.tier].loan.toLocaleString()} rUSDC`}
                    </button>
                  </div>
                )}
                {loan && (
                  <div className="loanbox">
                    <h3>Active loan</h3>
                    <p className="mono loanterms">
                      Principal: {(Number(loan.principal) / 1e6).toLocaleString()} rUSDC
                      <br />
                      Due: {(Number(loan.amountDue) / 1e6).toLocaleString()} rUSDC (5% interest)
                      <br />
                      Deadline: {new Date(Number(loan.dueAt) * 1000).toLocaleDateString()}
                      <br />
                      Tier: {TIER_INFO[loan.tier].name}
                    </p>
                    <button className="cta secondary" onClick={handleRepay}>
                      Repay {(Number(loan.amountDue) / 1e6).toLocaleString()} rUSDC
                    </button>
                  </div>
                )}
                {loanStatus && <p className="mono loanresult">{loanStatus}</p>}
                <button className="ghost" onClick={reset}>
                  New application
                </button>
              </>
            )}
          </section>
        )}

        {error && <div className="errorbar mono">{error}</div>}

        <footer className="footer">
          <span className="muted">
            Built on the Zama Protocol. Contracts verified on Sepolia. Demo inputs are partly self-reported; production
            uses attested credentials throughout. Not a real credit decision.
          </span>
        </footer>
      </main>
    </div>
  );
}

function shortErr(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 220 ? msg.slice(0, 220) + "..." : msg;
}
