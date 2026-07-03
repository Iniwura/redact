import { usePublicClient } from "wagmi";
import { useReveal, countUp } from "../lib/motion";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { POOL_ADDRESS, REDACT_ADDRESS, USDC_ADDRESS, POOL_ABI } from "../lib/contracts";

export default function Pool() {
  useReveal();
  const publicClient = usePublicClient();
  const [stats, setStats] = useState<{ liquidity: bigint; issued: bigint; rejected: bigint } | null>(null);

  const liqRef = useRef<HTMLSpanElement>(null);
  const issuedRef = useRef<HTMLSpanElement>(null);
  const rejectedRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!publicClient) return;
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        try {
          const [liquidity, issued, rejected] = await Promise.all([
            publicClient.readContract({ address: POOL_ADDRESS, abi: POOL_ABI, functionName: "liquidity" }),
            publicClient.readContract({ address: POOL_ADDRESS, abi: POOL_ABI, functionName: "totalLoansIssued" }),
            publicClient.readContract({ address: POOL_ADDRESS, abi: POOL_ABI, functionName: "totalLoansRejected" }),
          ]);
          if (cancelled) return;
          setStats({ liquidity: liquidity as bigint, issued: issued as bigint, rejected: rejected as bigint });
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicClient]);

  useEffect(() => {
    if (!stats) return;
    countUp(liqRef.current, Math.round(Number(stats.liquidity) / 1e6));
    countUp(issuedRef.current, Number(stats.issued));
    countUp(rejectedRef.current, Number(stats.rejected));
  }, [stats]);

  return (
    <main>
      <section className="page-head rv">
        <p className="eyebrow mono">LENDING POOL</p>
        <h1 className="display-sm serif">Priced by tiers, blind to data.</h1>
        <p className="lede">
          The pool underwrites loans on one input: a KMS-proven risk tier from the Redact oracle. It has never seen a
          score, a feature, or an identity. It cannot.
        </p>
      </section>

      <section className="stats-row">
        <div className="stat" onMouseEnter={() => stats && countUp(liqRef.current, Math.round(Number(stats.liquidity) / 1e6))}>
          <span className="stat-num serif" ref={liqRef}>0</span>
          <span className="stat-label mono">rUSDC available liquidity</span>
        </div>
        <div className="stat" onMouseEnter={() => stats && countUp(issuedRef.current, Number(stats.issued))}>
          <span className="stat-num serif" ref={issuedRef}>0</span>
          <span className="stat-label mono">loans issued</span>
        </div>
        <div className="stat" onMouseEnter={() => stats && countUp(rejectedRef.current, Number(stats.rejected))}>
          <span className="stat-num serif" ref={rejectedRef}>0</span>
          <span className="stat-label mono">requests declined</span>
        </div>
      </section>

      <section className="card">
        <h2 className="serif">Terms by tier</h2>
        <table className="terms">
          <thead>
            <tr className="mono">
              <th>Tier</th>
              <th>Credit line</th>
              <th>Interest</th>
              <th>Term</th>
              <th>What the pool learns</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <span className="verdict mono tier-gold">GOLD</span>
              </td>
              <td className="mono">2,500 rUSDC</td>
              <td className="mono">5%</td>
              <td className="mono">30 days</td>
              <td>The tier. Nothing else.</td>
            </tr>
            <tr>
              <td>
                <span className="verdict mono tier-silver">SILVER</span>
              </td>
              <td className="mono">1,000 rUSDC</td>
              <td className="mono">5%</td>
              <td className="mono">30 days</td>
              <td>The tier. Nothing else.</td>
            </tr>
            <tr>
              <td>
                <span className="verdict mono tier-bronze">BRONZE</span>
              </td>
              <td className="mono">500 rUSDC</td>
              <td className="mono">5%</td>
              <td className="mono">30 days</td>
              <td>The tier. Nothing else.</td>
            </tr>
            <tr>
              <td>
                <span className="verdict mono tier-red">REJECTED</span>
              </td>
              <td className="mono">0</td>
              <td className="mono">—</td>
              <td className="mono">—</td>
              <td>The tier. Nothing else.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 className="serif">Contracts</h2>
        <div className="chips">
          <a className="chip mono" href={`https://sepolia.etherscan.io/address/${REDACT_ADDRESS}#code`} target="_blank" rel="noreferrer">
            Redact oracle ↗
          </a>
          <a className="chip mono" href={`https://sepolia.etherscan.io/address/${POOL_ADDRESS}#code`} target="_blank" rel="noreferrer">
            Lending pool ↗
          </a>
          <a className="chip mono" href={`https://sepolia.etherscan.io/address/${USDC_ADDRESS}#code`} target="_blank" rel="noreferrer">
            rUSDC token ↗
          </a>
        </div>
        <p className="muted">
          All three verified on Sepolia. The oracle runs a quantized logistic regression under FHE; the pool consumes
          tiers via KMS-proven public decryption; the token is a demo ERC20 with an open faucet.
        </p>
      </section>

      <section className="section cta-band">
        <h2 className="serif">See your tier without showing your hand.</h2>
        <Link to="/apply" className="btn primary">
          Apply confidentially
        </Link>
      </section>
    </main>
  );
}
