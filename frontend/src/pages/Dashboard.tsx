import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useReveal } from "../lib/motion";
import { useAccount, useEnsName, usePublicClient, useWalletClient } from "wagmi";
import { parseAbiItem, createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { decodeEventLog } from "viem";
import {
  REDACT_ADDRESS,
  POOL_ADDRESS,
  USDC_ADDRESS,
  REDACT_ABI,
  POOL_ABI,
  ERC20_ABI,
  TIER_INFO,
} from "../lib/contracts";
import { userDecrypt, publicDecryptWithProof } from "../lib/fhe";
import { countUp } from "../lib/motion";

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="18" height="18" aria-hidden="true">
      {off ? (
        <>
          <path d="M4 4l16 16" />
          <path d="M10.6 5.3A9.9 9.9 0 0 1 12 5.2c5 0 8.6 4 9.7 6.8-.4 1-1.2 2.3-2.4 3.5M6.6 6.9C4.6 8.2 3.1 10.2 2.3 12c1.1 2.8 4.7 6.8 9.7 6.8 1.3 0 2.5-.3 3.6-.7" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        </>
      ) : (
        <>
          <path d="M2.3 12C3.4 9.2 7 5.2 12 5.2S20.6 9.2 21.7 12c-1.1 2.8-4.7 6.8-9.7 6.8S3.4 14.8 2.3 12z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

const ZERO_HANDLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

type Verdict = { approved: boolean; score: bigint; tier: number } | null;
type LoanInfo = { principal: bigint; amountDue: bigint; dueAt: bigint; tier: number } | null;

export default function Dashboard() {
  useReveal();
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { data: ensName } = useEnsName({ address, chainId: 1 });

  const [hasApplication, setHasApplication] = useState<boolean | null>(null);
  const [appTimestamp, setAppTimestamp] = useState<bigint | null>(null);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [loan, setLoan] = useState<LoanInfo>(null);
  const [pendingExists, setPendingExists] = useState(false);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [totalRepaid, setTotalRepaid] = useState<bigint | null>(null);
  const [privacy, setPrivacy] = useState(false);
  const [forgeResult, setForgeResult] = useState<string>("");
  const [forging, setForging] = useState(false);
  const [flowStatus, setFlowStatus] = useState("");
  const [decrypting, setDecrypting] = useState(false);
  const [error, setError] = useState("");

  const loadState = useCallback(async () => {
    if (!address || !publicClient) return;
    try {
      const [exists, l, p, bal] = await Promise.all([
        publicClient.readContract({ address: REDACT_ADDRESS, abi: REDACT_ABI, functionName: "applicationExists", args: [address] }),
        publicClient.readContract({ address: POOL_ADDRESS, abi: POOL_ABI, functionName: "loans", args: [address] }),
        publicClient.readContract({ address: POOL_ADDRESS, abi: POOL_ABI, functionName: "pending", args: [address] }),
        publicClient.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
      ]);
      setHasApplication(Boolean(exists));
      const loanTuple = l as readonly [bigint, bigint, bigint, number, boolean];
      setLoan(loanTuple[4] ? { principal: loanTuple[0], amountDue: loanTuple[1], dueAt: loanTuple[2], tier: loanTuple[3] } : null);
      const pendingTuple = p as readonly [bigint, string, boolean];
      setPendingExists(Boolean(pendingTuple[2]) && pendingTuple[1] !== ZERO_HANDLE);
      setBalance(bal as bigint);

      // Total repaid: summed from onchain LoanRepaid events for this borrower.
      try {
        // dRPC free tier caps eth_getLogs at 10k blocks per request, so walk
        // backwards in 9,999-block chunks. 12 chunks covers ~2 weeks of Sepolia,
        // comfortably spanning this deployment's lifetime for anyone visiting later.
        const logsClient = createPublicClient({ chain: sepolia, transport: http("https://sepolia.drpc.org") });
        const latest = await logsClient.getBlockNumber();
        const CHUNK = 9_999n;
        let repaid = 0n;
        let found = false;
        for (let i = 0n; i < 12n; i++) {
          const to = latest - i * CHUNK;
          if (to <= 0n) break;
          const from = to > CHUNK ? to - CHUNK + 1n : 0n;
          try {
            const logs = await logsClient.getLogs({
              address: POOL_ADDRESS,
              event: parseAbiItem("event LoanRepaid(address indexed borrower, uint256 amount)"),
              args: { borrower: address },
              fromBlock: from,
              toBlock: to,
            });
            repaid += logs.reduce((acc, l) => acc + ((l.args.amount as bigint) ?? 0n), 0n);
            found = true;
          } catch (err) {
            console.warn(`LoanRepaid chunk ${from}-${to} failed`, err);
          }
        }
        setTotalRepaid(found ? repaid : null);
      } catch {
        setTotalRepaid(null);
      }
      if (exists) {
        const ts = (await publicClient.readContract({
          address: REDACT_ADDRESS,
          abi: REDACT_ABI,
          functionName: "applicationTimestamp",
          args: [address],
        })) as bigint;
        setAppTimestamp(ts);
      }
    } catch (e) {
      console.error(e);
    }
  }, [address, publicClient]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  async function mustSucceed(hash: `0x${string}`, what: string) {
    const receipt = await publicClient!.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`${what} reverted onchain (tx ${hash.slice(0, 10)}...). See Etherscan for the reason.`);
    }
    return receipt;
  }

  async function handleUnmask() {
    if (!address || !walletClient || !publicClient) return;
    setError("");
    setDecrypting(true);
    try {
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
      setVerdict({
        approved: Boolean(result[verdictHandle as string]),
        score: BigInt(result[scoreHandle as string] as bigint),
        tier: Number(result[tierHandle as string]),
      });
    } catch (e) {
      console.error(e);
      setError(shortErr(e));
    } finally {
      setDecrypting(false);
    }
  }

  async function handleBorrow() {
    if (!address || !walletClient || !publicClient) return;
    setError("");
    try {
      setFlowStatus("1/4 Authorizing the pool to read your tier (never your score or data)...");
      const authHash = await walletClient.writeContract({
        address: REDACT_ADDRESS,
        abi: REDACT_ABI,
        functionName: "authorizeLender",
        args: [POOL_ADDRESS],
        account: address,
        chain: walletClient.chain,
      });
      await mustSucceed(authHash, "Lender authorization");

      let tierHandle: string | null = null;

      const existing = (await publicClient.readContract({
        address: POOL_ADDRESS,
        abi: POOL_ABI,
        functionName: "pending",
        args: [address],
      })) as readonly [bigint, string, boolean];

      if (existing[2] && existing[1] !== ZERO_HANDLE) {
        setFlowStatus("2/4 Resuming your pending loan request...");
        tierHandle = existing[1];
      } else {
        setFlowStatus("2/4 Requesting a loan priced by your confidential tier...");
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
            /* not our event */
          }
        }
      }

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
        throw new Error("Could not obtain the tier handle. Wait a few seconds and press borrow again.");
      }

      setFlowStatus("3/4 Fetching the KMS decryption proof for your tier...");
      const proof = await publicDecryptWithProof(tierHandle);

      setFlowStatus("4/4 Submitting the proof onchain. Forged tiers revert here.");
      const finHash = await walletClient.writeContract({
        address: POOL_ADDRESS,
        abi: POOL_ABI,
        functionName: "finalizeLoan",
        args: [address, proof.abiEncodedClearValues, proof.decryptionProof],
        account: address,
        chain: walletClient.chain,
      });
      await mustSucceed(finHash, "Loan finalization");

      setFlowStatus("Done. If your tier qualified, the rUSDC is in your wallet.");
      await loadState();
    } catch (e) {
      console.error(e);
      setError(shortErr(e));
      setFlowStatus("");
    }
  }

  async function handleForge() {
    if (!address || !publicClient) return;
    setForging(true);
    setForgeResult("");
    try {
      // A forged approval: tier 3 cleartext with a fabricated decryption proof.
      const forgedTier = "0x0000000000000000000000000000000000000000000000000000000000000003" as `0x${string}`;
      const forgedProof = ("0x" + "ff".repeat(260)) as `0x${string}`;
      await publicClient.simulateContract({
        address: POOL_ADDRESS,
        abi: POOL_ABI,
        functionName: "finalizeLoan",
        args: [address, forgedTier, forgedProof],
        account: address,
      });
      setForgeResult("Unexpected: the forgery was accepted. This should never happen.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const reason = msg.includes("no pending request")
        ? "Reverted: no pending request to forge against. Start a borrow first, then try forging."
        : "Reverted by the chain. The KMS signature check rejected the forged tier. This is why lenders can trust a verdict they cannot read.";
      setForgeResult(reason);
    } finally {
      setForging(false);
    }
  }

  async function handleRepay() {
    if (!address || !walletClient || !publicClient || !loan) return;
    setError("");
    try {
      if (balance !== null && balance < loan.amountDue) {
        const shortBy = Number(loan.amountDue - balance) / 1e6;
        throw new Error(
          `You are ${shortBy.toLocaleString()} rUSDC short of the amount due (interest). Use the + faucet in the nav, then repay.`,
        );
      }
      setFlowStatus("Approving repayment (principal + 5% interest)...");
      const approveHash = await walletClient.writeContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [POOL_ADDRESS, loan.amountDue],
        account: address,
        chain: walletClient.chain,
      });
      await mustSucceed(approveHash, "Repay approval");

      setFlowStatus("Repaying...");
      const repayHash = await walletClient.writeContract({
        address: POOL_ADDRESS,
        abi: POOL_ABI,
        functionName: "repay",
        args: [],
        account: address,
        chain: walletClient.chain,
      });
      await mustSucceed(repayHash, "Repayment");

      setFlowStatus("Repaid in full. Credit line closed clean.");
      await loadState();
    } catch (e) {
      console.error(e);
      setError(shortErr(e));
    }
  }

  const tierInfo = verdict ? TIER_INFO[Math.min(verdict.tier, 3)] : null;

  return (
    <main>
      <section className="page-head rv">
        <p className="eyebrow mono">DASHBOARD</p>
        <h1 className="display-sm serif">Your vault.</h1>
        <p className="lede">Everything here is rebuilt from the chain each time you load the page. Nothing is stored anywhere else.</p>
      </section>

      {!isConnected && (
        <section className="card center">
          <p className="muted">Connect a wallet to see your confidential state.</p>
        </section>
      )}

      {isConnected && (
        <>
          <section className="card profile-card rv in">
            <button
              className={privacy ? "eye-btn on" : "eye-btn"}
              onClick={() => setPrivacy((v) => !v)}
              title={privacy ? "Show my details" : "Hide my details for demos"}
              aria-label={privacy ? "Show my details" : "Hide my details"}
            >
              <EyeIcon off={privacy} />
            </button>
            <span className="profile-eyebrow mono">OPERATIVE FILE</span>
            <h2 className="profile-name">
              {privacy ? (
                <span className="priv-bar wide" aria-label="redacted" />
              ) : (
                <span className="unmask-word">
                  <span className="unmask-cover" aria-hidden="true" />
                  <span className="unmask-text">{ensName ?? `AGENT ${address?.slice(-4).toUpperCase()}`}</span>
                </span>
              )}
            </h2>
            <span className="profile-sub mono">{privacy ? <span className="priv-bar wide" /> : address}</span>
            <div className="profile-stats">
              <div
                className="pstat"
                onMouseEnter={(e) =>
                  !privacy && balance !== null && countUp(e.currentTarget.querySelector(".pstat-num"), Math.round(Number(balance) / 1e6))
                }
              >
                <span className="pstat-num">
                  {privacy ? <span className="priv-bar" /> : balance !== null ? (Number(balance) / 1e6).toLocaleString() : "0"}
                </span>
                <span className="pstat-label mono">available rUSDC</span>
              </div>
              <div
                className="pstat"
                onMouseEnter={(e) =>
                  !privacy && loan && countUp(e.currentTarget.querySelector(".pstat-num"), Math.round(Number(loan.amountDue) / 1e6))
                }
              >
                <span className={loan && !privacy ? "pstat-num accent urgent" : "pstat-num accent"}>
                  {privacy ? <span className="priv-bar" /> : loan ? (Number(loan.amountDue) / 1e6).toLocaleString() : "0"}
                </span>
                <span className="pstat-label mono">
                  loan outstanding
                  {loan && !privacy && (
                    <span className="due-tag mono">
                      DUE IN {Math.max(0, Math.ceil((Number(loan.dueAt) * 1000 - Date.now()) / 86_400_000))}D
                    </span>
                  )}
                </span>
              </div>
              <div
                className="pstat"
                onMouseEnter={(e) =>
                  !privacy &&
                  totalRepaid !== null &&
                  countUp(e.currentTarget.querySelector(".pstat-num"), Math.round(Number(totalRepaid) / 1e6))
                }
              >
                <span className="pstat-num">
                  {privacy ? <span className="priv-bar" /> : totalRepaid !== null ? (Number(totalRepaid) / 1e6).toLocaleString() : "0"}
                </span>
                <span className="pstat-label mono">total repaid</span>
              </div>
            </div>
          </section>

          <section className="card">
            <h2 className="serif">Credit application</h2>
            {hasApplication === null && <p className="muted">Reading the chain...</p>}
            {hasApplication === false && (
              <>
                <p className="muted">No application on record for this wallet.</p>
                <Link to="/apply" className="btn primary">
                  Apply confidentially
                </Link>
              </>
            )}
            {hasApplication && (
              <>
                <p className="muted">
                  Application on record since{" "}
                  {appTimestamp ? new Date(Number(appTimestamp) * 1000).toLocaleString() : "..."}. Encrypted score,
                  verdict, and tier are sealed onchain.
                </p>
                {!verdict ? (
                  <button className="btn primary" onClick={handleUnmask} disabled={decrypting}>
                    {decrypting ? "Requesting decryption..." : "Unmask my result (only you can)"}
                  </button>
                ) : (
                  <div className="verdict-line">
                    <span className="mono">
                      Score <span className="revealed">{verdict.score.toString()}</span>
                    </span>
                    <span className={`verdict mono tier-${tierInfo!.color}`}>{tierInfo!.name}</span>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="card">
            <h2 className="serif">Credit line</h2>
            {loan ? (
              <>
                <div className="loan-grid mono">
                  <div>
                    <span className="loan-k">Principal</span>
                    <span className="loan-v">{(Number(loan.principal) / 1e6).toLocaleString()} rUSDC</span>
                  </div>
                  <div>
                    <span className="loan-k">Amount due</span>
                    <span className="loan-v">{(Number(loan.amountDue) / 1e6).toLocaleString()} rUSDC</span>
                  </div>
                  <div>
                    <span className="loan-k">Deadline</span>
                    <span className="loan-v">{new Date(Number(loan.dueAt) * 1000).toLocaleDateString()}</span>
                  </div>
                  <div>
                    <span className="loan-k">Tier</span>
                    <span className={`loan-v tier-${TIER_INFO[loan.tier].color}`}>{TIER_INFO[loan.tier].name}</span>
                  </div>
                </div>
                <button className="btn primary" onClick={handleRepay}>
                  Repay {(Number(loan.amountDue) / 1e6).toLocaleString()} rUSDC
                </button>
              </>
            ) : hasApplication ? (
              <>
                <p className="muted">
                  No active loan. {pendingExists ? "You have a pending request; borrowing resumes it." : ""} Unmask
                  your tier above, then borrow against it. The pool learns your tier with a KMS proof, nothing else.
                </p>
                <button className="btn primary" onClick={handleBorrow} disabled={!!flowStatus && !flowStatus.startsWith("Done")}>
                  {flowStatus && !flowStatus.startsWith("Done") && !flowStatus.startsWith("Repaid")
                    ? flowStatus
                    : pendingExists
                      ? "Resume pending loan request"
                      : "Borrow against my tier"}
                </button>
              </>
            ) : (
              <p className="muted">Apply first, then your credit line opens here.</p>
            )}
            {flowStatus && (flowStatus.startsWith("Done") || flowStatus.startsWith("Repaid")) && (
              <p className="mono loanresult">{flowStatus}</p>
            )}
            {hasApplication && (
              <div className="forge-box">
                <p className="muted">
                  Do not trust us, test us: submit a forged GOLD tier with a fake decryption proof and watch the
                  contract reject it.
                </p>
                <button className="btn ghost-btn" onClick={handleForge} disabled={forging}>
                  {forging ? "Simulating forgery..." : "Try to forge a GOLD tier"}
                </button>
                {forgeResult && <p className="mono forge-result">{forgeResult}</p>}
              </div>
            )}
          </section>
        </>
      )}

      {error && <div className="errorbar mono">{error}</div>}
    </main>
  );
}

function shortErr(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 220 ? msg.slice(0, 220) + "..." : msg;
}
