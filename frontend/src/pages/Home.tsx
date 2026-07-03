import { Link } from "react-router-dom";
import { usePublicClient } from "wagmi";
import { useEffect, useRef, useState } from "react";
import { REDACT_ADDRESS, POOL_ADDRESS, REDACT_ABI, POOL_ABI } from "../lib/contracts";
import { useReveal, countUp } from "../lib/motion";

const MARQUEE = "NOBODY READS YOU · ENCRYPTED END TO END · AI ON CIPHERTEXT · LIVE ON SEPOLIA · ";

function IconLock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="26" height="26" aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" />
      <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
      <circle cx="12" cy="15.2" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconChip() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="26" height="26" aria-hidden="true">
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
      <path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3" />
    </svg>
  );
}

function IconEyeOff() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="26" height="26" aria-hidden="true">
      <path d="M4 4l16 16" />
      <path d="M10.6 5.3A9.9 9.9 0 0 1 12 5.2c5 0 8.6 4 9.7 6.8-.4 1-1.2 2.3-2.4 3.5M6.6 6.9C4.6 8.2 3.1 10.2 2.3 12c1.1 2.8 4.7 6.8 9.7 6.8 1.3 0 2.5-.3 3.6-.7" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true" className="btn-arrow">
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

export default function Home() {
  const publicClient = usePublicClient();
  const [stats, setStats] = useState<{ apps: number; liquidity: number; issued: number; model: number } | null>(null);
  const appsRef = useRef<HTMLSpanElement>(null);
  const liqRef = useRef<HTMLSpanElement>(null);
  const issuedRef = useRef<HTMLSpanElement>(null);

  useReveal([stats]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!publicClient) return;
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        try {
          const [apps, liquidity, issued, model] = await Promise.all([
            publicClient.readContract({ address: REDACT_ADDRESS, abi: REDACT_ABI, functionName: "totalApplications" }),
            publicClient.readContract({ address: POOL_ADDRESS, abi: POOL_ABI, functionName: "liquidity" }),
            publicClient.readContract({ address: POOL_ADDRESS, abi: POOL_ABI, functionName: "totalLoansIssued" }),
            publicClient.readContract({ address: REDACT_ADDRESS, abi: REDACT_ABI, functionName: "modelVersion" }),
          ]);
          if (cancelled) return;
          setStats({
            apps: Number(apps),
            liquidity: Math.round(Number(liquidity) / 1e6),
            issued: Number(issued),
            model: Number(model),
          });
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
    countUp(appsRef.current, stats.apps);
    countUp(liqRef.current, stats.liquidity);
    countUp(issuedRef.current, stats.issued);
  }, [stats]);

  return (
    <main>
      <section className="hero">
        <p className="eyebrow mono hero-seq s1">CONFIDENTIAL AI CREDIT ORACLE · LIVE ON SEPOLIA</p>
        <h1 className="display">
          <span className="hero-seq s2 block">The AI scores you.</span>
          <span className="hero-seq s3 block">
            <span className="unmask-word">
              <span className="unmask-cover" aria-hidden="true" />
              <span className="unmask-text">Nobody</span>
            </span>{" "}
            reads you.
          </span>
        </h1>
        <p className="lede hero-seq s4">
          A machine learning credit model that runs fully homomorphically encrypted on Ethereum. Your financial data is
          encrypted on your device, scored while still encrypted, and priced into a risk tier only you can unmask.
          Lenders see the tier. Never the score. Never the data.
        </p>
        <div className="hero-ctas hero-seq s5">
          <Link to="/apply" className="btn primary">
            Run a confidential credit check <Arrow />
          </Link>
          <Link to="/pool" className="btn ghost-btn">
            Explore the pool
          </Link>
        </div>
        <div className="scroll-hint hero-seq s6" aria-hidden="true">
          <span className="mono">SCROLL</span>
          <span className="scroll-line" />
        </div>
      </section>

      <div className="marquee" aria-hidden="true">
        <div className="marquee-track mono">
          <span>{MARQUEE.repeat(4)}</span>
          <span>{MARQUEE.repeat(4)}</span>
        </div>
      </div>

      <section className="stats-row rv">
        <div className="stat" onMouseEnter={() => stats && countUp(appsRef.current, stats.apps)}>
          <span className="stat-num serif" ref={appsRef}>
            {stats ? "" : "0"}
          </span>
          <span className="stat-label mono">encrypted applications scored</span>
        </div>
        <div className="stat" onMouseEnter={() => stats && countUp(liqRef.current, stats.liquidity)}>
          <span className="stat-num serif" ref={liqRef}>
            {stats ? "" : "0"}
          </span>
          <span className="stat-label mono">rUSDC pool liquidity</span>
        </div>
        <div className="stat" onMouseEnter={() => stats && countUp(issuedRef.current, stats.issued)}>
          <span className="stat-num serif" ref={issuedRef}>
            {stats ? "" : "0"}
          </span>
          <span className="stat-label mono">loans issued on tiers</span>
        </div>
        <div className="stat">
          <span className="stat-num serif">{stats ? `v${stats.model}` : "v1"}</span>
          <span className="stat-label mono">model version onchain</span>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title serif rv">Three steps. Zero exposure.</h2>
        <div className="steps rv-stagger">
          <div className="step rv">
            <span className="step-icon">
              <IconLock />
            </span>
            <span className="step-k mono">ENCRYPT</span>
            <h3>Your data locks on your device</h3>
            <p>
              Eight financial features are encrypted in your browser with Zama FHE before anything touches the chain.
              The plaintext never leaves your machine.
            </p>
          </div>
          <div className="step rv">
            <span className="step-icon">
              <IconChip />
            </span>
            <span className="step-k mono">SCORE</span>
            <h3>The model runs on ciphertext</h3>
            <p>
              A trained logistic regression classifier executes onchain over your encrypted features. Validators,
              operators, and the model owner see nothing but ciphertext.
            </p>
          </div>
          <div className="step rv">
            <span className="step-icon">
              <IconEyeOff />
            </span>
            <span className="step-k mono">UNMASK</span>
            <h3>You choose what leaves the vault</h3>
            <p>
              Only your signature can decrypt the verdict. Authorize a lender and they learn one coarse tier, backed by
              a KMS proof. The score and the data stay sealed forever.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title serif rv">One oracle. Many doors.</h2>
        <p className="section-lede rv">
          Confidential lending is the first door. The same primitive, an AI verdict computed on data nobody can read,
          unlocks every decision that today demands surveillance.
        </p>
        <div className="doors rv-stagger">
          <div className="door rv">
            <h3>Undercollateralized DeFi</h3>
            <p>Borrow against creditworthiness instead of locking 150 percent collateral. Live in this demo.</p>
            <span className="door-status live mono">LIVE</span>
          </div>
          <div className="door rv">
            <h3>Insurance underwriting</h3>
            <p>Premium tiers priced on encrypted health or driving data the insurer never sees.</p>
            <span className="door-status mono">ROADMAP</span>
          </div>
          <div className="door rv">
            <h3>Rental screening</h3>
            <p>Prove you can pay the rent without handing a landlord your bank statements.</p>
            <span className="door-status mono">ROADMAP</span>
          </div>
          <div className="door rv">
            <h3>Sybil-resistant governance</h3>
            <p>Weight votes by confidential reputation without exposing any member's history.</p>
            <span className="door-status mono">ROADMAP</span>
          </div>
        </div>
      </section>

      <section className="cta-band rv">
        <div className="cta-inner">
          <p className="eyebrow-dark mono">REDACT</p>
          <h2 className="serif">Your data has been public long enough.</h2>
          <Link to="/apply" className="btn dark">
            Apply confidentially <Arrow />
          </Link>
        </div>
      </section>
    </main>
  );
}
