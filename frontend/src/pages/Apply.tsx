import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useReveal } from "../lib/motion";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { REDACT_ADDRESS, REDACT_ABI, FEATURES, TIER_INFO } from "../lib/contracts";
import { encryptFeatures, userDecrypt } from "../lib/fhe";

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="14" height="14" aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="9" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </svg>
  );
}

type Phase = "form" | "encrypting" | "submitting" | "submitted" | "decrypting" | "revealed";
type Verdict = { approved: boolean; score: bigint; tier: number } | null;

export default function Apply() {
  useReveal();
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [values, setValues] = useState<number[]>(FEATURES.map((f) => f.default));
  const [attested, setAttested] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [status, setStatus] = useState("");
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      if (!address || !publicClient) return;
      try {
        const txCount = await publicClient.getTransactionCount({ address });
        setValues((prev) => {
          const next = [...prev];
          next[7] = Math.min(txCount, 200);
          return next;
        });
        setAttested(true);
      } catch {
        setAttested(false);
      }
    })();
  }, [address, publicClient]);

  const setValue = (i: number, v: number) => {
    if (FEATURES[i].attested) return;
    const next = [...values];
    next[i] = v;
    setValues(next);
  };

  async function mustSucceed(hash: `0x${string}`, what: string) {
    const receipt = await publicClient!.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`${what} reverted onchain (tx ${hash.slice(0, 10)}...). See Etherscan for the reason.`);
    }
    return receipt;
  }

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

      setVerdict({
        approved: Boolean(result[verdictHandle as string]),
        score: BigInt(result[scoreHandle as string] as bigint),
        tier: Number(result[tierHandle as string]),
      });
      setPhase("revealed");
      setStatus("");
    } catch (e) {
      console.error(e);
      setError(shortErr(e));
      setPhase("submitted");
    }
  }

  const busy = phase === "encrypting" || phase === "submitting" || phase === "decrypting";
  const tierInfo = verdict ? TIER_INFO[Math.min(verdict.tier, 3)] : null;

  return (
    <main>
      <section className="page-head rv">
        <p className="eyebrow mono">APPLICATION</p>
        <h1 className="display-sm serif">Apply without exposure.</h1>
        <p className="lede">
          Self-reported values are encrypted in your browser before anything touches the chain. The onchain activity
          field is attested: read directly from Sepolia, not editable, not fakeable.
        </p>
      </section>

      {!isConnected && (
        <section className="card center">
          <p className="muted">Connect a wallet on Sepolia to run a confidential credit check.</p>
        </section>
      )}

      {isConnected && (phase === "form" || busy) && (
        <section className="card">
          <div className="grid">
            {FEATURES.map((f, i) => (
              <div className="field" key={f.key}>
                <label>
                  {f.label} <span className="hint">({f.hint})</span>
                  {f.attested && <span className="attested-badge mono">{attested ? "ATTESTED" : "READING"}</span>}
                </label>
                <div className="fieldrow">
                  <div style={{ flex: 1 }}>
                    <input
                      type="range"
                      className="slider"
                      style={{
                        width: "100%",
                        background: `linear-gradient(to right, var(--accent) ${((values[i] - f.min) / (f.max - f.min)) * 100}%, var(--line) ${((values[i] - f.min) / (f.max - f.min)) * 100}%)`,
                      }}
                      min={f.min}
                      max={f.max}
                      value={values[i]}
                      disabled={busy || f.attested}
                      onChange={(e) => setValue(i, Number(e.target.value))}
                    />
                    <div className="slider-meta">
                      <span>{f.min}</span>
                      <span>{f.max}</span>
                    </div>
                  </div>
                  <input
                    type="number"
                    className="num mono"
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
          <div className="soon-wrap">
            <p className="soon-title mono">ATTESTED SOURCES · COMING SOON</p>
            <div className="soon-chips">
              <span className="soon-chip">
                <LockIcon /> Import from bank statement <span className="soon-tag">zkTLS</span>
              </span>
              <span className="soon-chip">
                <LockIcon /> Attest Aave repayment history <span className="soon-tag">ONCHAIN</span>
              </span>
              <span className="soon-chip">
                <LockIcon /> Verify payroll income <span className="soon-tag">SIGNED</span>
              </span>
              <span className="soon-chip">
                <LockIcon /> Credit bureau credential <span className="soon-tag">EAS</span>
              </span>
            </div>
          </div>
          <button className="btn primary wide" onClick={handleSubmit} disabled={busy}>
            {busy ? status : "Encrypt and submit"}
          </button>
          {busy && <div className="pulse" />}
        </section>
      )}

      {isConnected && (phase === "submitted" || phase === "decrypting" || phase === "revealed") && (
        <section className="card">
          <h2 className="serif">Onchain record</h2>
          <p className="muted">This is everything the world can see about your application:</p>
          <div className="redactions">
            {FEATURES.map((f) => (
              <div className="redaction-row" key={f.key}>
                <span className="redaction-label mono">{f.label}</span>
                <span className="redaction-bar" aria-label="redacted" />
              </div>
            ))}
            <div className="redaction-row">
              <span className="redaction-label mono">Credit score</span>
              {phase === "revealed" && verdict ? (
                <span className="revealed mono">{verdict.score.toString()}</span>
              ) : (
                <span className="redaction-bar" />
              )}
            </div>
            <div className="redaction-row">
              <span className="redaction-label mono">Risk tier</span>
              {phase === "revealed" && verdict && tierInfo ? (
                <span className={`verdict mono tier-${tierInfo.color}`}>{tierInfo.name}</span>
              ) : (
                <span className="redaction-bar" />
              )}
            </div>
          </div>
          {txHash && (
            <a className="chip mono" href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer">
              Submission tx ↗
            </a>
          )}
          {phase !== "revealed" && (
            <button className="btn primary wide" onClick={handleReveal} disabled={phase === "decrypting"}>
              {phase === "decrypting" ? status : "Unmask my result (only you can)"}
            </button>
          )}
          {phase === "revealed" && verdict && tierInfo && (
            <>
              <p className="muted">
                Decrypted with your signature alone. The feature bars stay black forever. That is not a UI choice, it
                is cryptography.
              </p>
              {verdict.tier >= 1 ? (
                <Link to="/dashboard" className="btn primary wide">
                  Use your {tierInfo.name} tier: borrow up to {TIER_INFO[verdict.tier].loan.toLocaleString()} rUSDC
                </Link>
              ) : (
                <button className="btn ghost-btn wide" onClick={() => { setPhase("form"); setVerdict(null); setTxHash(""); }}>
                  Improve the profile and reapply
                </button>
              )}
            </>
          )}
        </section>
      )}

      {error && <div className="errorbar mono">{error}</div>}
    </main>
  );
}

function shortErr(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 220 ? msg.slice(0, 220) + "..." : msg;
}
