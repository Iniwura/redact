import { Link } from "react-router-dom";
import { useReveal } from "../lib/motion";

const PHASES = [
  {
    tag: "PHASE 0 · LIVE NOW",
    title: "Confidential credit oracle",
    live: true,
    items: [
      "Trained logistic regression scoring encrypted features onchain (FHEVM)",
      "Graded privacy: ciphertext to the world, tier to lenders, score to you, inputs to no one",
      "Tier-priced lending pool with real token payouts, interest, and terms",
      "Chain-attested activity feature and KMS-proof verified consumption",
    ],
  },
  {
    tag: "PHASE 1 · NEXT",
    title: "Attested everything",
    live: false,
    items: [
      "Bank statement import via zkTLS: prove income without revealing the statement",
      "Aave and Morpho repayment history attested directly from chain state",
      "Signed payroll credentials and credit bureau attestations via EAS",
      "Sybil-resistant identity binding so one person cannot farm fresh wallets",
    ],
  },
  {
    tag: "PHASE 2",
    title: "A real credit market",
    live: false,
    items: [
      "Variable rates priced per tier by pool utilization",
      "Multi-lender marketplace: any protocol consumes Redact verdicts permissionlessly",
      "Default recording against encrypted identity: your history follows you, privately",
      "Mainnet deployment with audited contracts",
    ],
  },
  {
    tag: "PHASE 3",
    title: "One oracle, many doors",
    live: false,
    items: [
      "Insurance underwriting on encrypted health and driving data",
      "Rental screening without bank statements",
      "Confidential hiring pre-checks and KYC threshold proofs",
      "Reputation-weighted governance without exposing any member",
    ],
  },
];

export default function Roadmap() {
  useReveal();
  return (
    <main>
      <section className="page-head rv">
        <p className="eyebrow mono">ROADMAP</p>
        <h1 className="display-sm serif">Where this goes.</h1>
        <p className="lede">
          The demo proves the primitive. The roadmap turns it into infrastructure: verified inputs, real markets, and
          every decision that today demands surveillance, rebuilt on encrypted rails.
        </p>
      </section>

      <div className="phases">
        {PHASES.map((p) => (
          <section className="card phase rv" key={p.tag}>
            <div className="phase-head">
              <span className={p.live ? "door-status live mono" : "door-status mono"}>{p.tag}</span>
              <h2 className="serif">{p.title}</h2>
            </div>
            <ul className="phase-list">
              {p.items.map((it) => (
                <li key={it}>{it}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="cta-band rv">
        <div className="cta-inner">
          <p className="eyebrow-dark mono">REDACT</p>
          <h2 className="serif">Phase zero is live. Try it.</h2>
          <Link to="/apply" className="btn dark">
            Apply confidentially
          </Link>
        </div>
      </section>
    </main>
  );
}
