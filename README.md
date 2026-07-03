# Redact

**A confidential AI credit oracle on Ethereum.** A trained machine learning model scores your creditworthiness while
your financial data stays fully encrypted. Nobody can read your inputs. Not the operator, not the validators, not the
model owner. Built on the Zama Protocol (FHEVM).

**Live demo:** https://redact-fhe.vercel.app (Sepolia) **Demo video:** [link] **X thread:** [link]

## The problem

To get a loan today you hand a stranger your entire financial life and hope they keep it safe. They do not. Equifax
leaked 147 million records. Every credit check is a surveillance event.

DeFi went the other way and gave up on credit entirely. No lender can check creditworthiness onchain, so everything is
overcollateralized: lock $150 to borrow $100. That is not lending, that is a pawnshop.

The reason nobody fixed this: judging creditworthiness has always required looking at the data. The look is the leak.

## What Redact does

Redact breaks that tradeoff using fully homomorphic encryption:

1. **Encrypt.** Eight financial features are encrypted in your browser. Plaintext never leaves your machine.
2. **Score.** A quantized logistic regression classifier runs onchain over the ciphertexts. The model computes a credit
   score and a risk tier without ever decrypting anything.
3. **Unmask.** Only your signature can decrypt your result. If you want a loan, you authorize a lender to consume your
   coarse tier, backed by a KMS proof that it is genuine. The score and the raw data stay sealed forever.

Privacy is graded, not binary:

| Who                  | What they can see                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| The world            | Ciphertexts                                                                                       |
| An authorized lender | One coarse tier (gold / silver / bronze / rejected), with a cryptographic proof it was not forged |
| You                  | Your score and tier                                                                               |
| Anyone, ever         | Your raw inputs: nothing                                                                          |

## What is live

- **Redact oracle** with a real trained model (logistic regression, test AUC 0.81, quantized to int32 with 98.98%
  fidelity to the float model), computing encrypted scores and FHE-derived risk tiers
- **Lending pool** that prices loans by tier (gold 2,500 / silver 1,000 / bronze 500 rUSDC), pays out real tokens,
  charges 5% interest on a 30 day term, and takes repayments
- **KMS-proof verification**: the pool only accepts a tier decryption if `FHE.checkSignatures` validates it. The dApp
  includes a forgery demo so you can watch a fake tier get rejected by the chain
- **Chain-attested input**: the onchain activity feature is read directly from Sepolia and cannot be edited
- **Model upgradability with an audit trail**: weights can be updated onchain, the version bumps, and every application
  records which model version scored it

## Contracts (Sepolia, all verified)

| Contract          | Address                                      |
| ----------------- | -------------------------------------------- |
| Redact oracle     | `0xc3f4d0cBA1E1b4813C36a896C16961EFFee180AD` |
| RedactLendingPool | `0x0e4eC1B0158615D6F266C8936198B71b357Ab45a` |
| RedactUSD (rUSDC) | `0x16107239DE7017a9DFc99dD30d7A7b8e0058fe35` |

Example encrypted inference round trip:
[tx 0x6fe114788cc6dd9b8091aca98ea85c846fb739f90956d0c6688835751075fbcf](https://sepolia.etherscan.io/tx/0x6fe114788cc6dd9b8091aca98ea85c846fb739f90956d0c6688835751075fbcf)

## How the FHE math works

FHEVM only supports unsigned encrypted integers, so the signed logistic regression is split into positive and negative
weight vectors:

```
posSum = bias + sum(posWeights[i] * features[i])
negSum = threshold + sum(negWeights[i] * features[i])
approved = posSum >= negSum
tier    = gold if margin >= 5000, silver if >= 2000, bronze if >= 0, else rejected
```

Every operation on the features runs through `FHE.add`, `FHE.mul`, `FHE.ge`, and `FHE.select` on ciphertexts. The
comparison is mathematically identical to the signed model. Weight quantization and overflow bounds are checked in
`scripts/train_weights.py`.

The model was trained on a synthetic dataset calibrated to published consumer credit statistics (n=50,000, seed=42, base
default rate near 20%). The training script accepts any real CSV with the same schema, so swapping in Lending Club data
is a one line change.

## Run it yourself

Contracts:

```bash
npm install
npx hardhat vars set MNEMONIC
npx hardhat vars set ALCHEMY_API_KEY
npx hardhat compile
npx hardhat test              # mock FHE, fast
npx hardhat deploy --network sepolia
npx hardhat test --network sepolia   # real FHE round trip
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Contract addresses live in `frontend/src/lib/contracts.ts`.

## Threat model and honest limits

Redact solves the privacy problem. It deliberately does not pretend to solve two adjacent problems, because they have
their own known solutions:

**What if I lie about my inputs?** In this demo you can. FHE guarantees your data stays private and the model runs
correctly on it, not that the data is true. Production fixes this with attested inputs: bank statements proven via
zkTLS, repayment history read from Aave, signed payroll credentials. One feature (onchain activity) is already
chain-attested in the demo to show the pattern. Note the current system has the same lying problem and solves it with
total surveillance. Redact keeps the verification and deletes the surveillance.

**What if I take the loan and run?** Default risk is what credit is. The model literally predicts it, and rates price
it, same as every lender on earth. Production layers add partial collateral, default records against encrypted identity,
and tiered rates. The innovation is not eliminating default risk, it is pricing it without reading your life.

**Known limitations of this deployment:**

- Requesting a loan makes your tier publicly decryptable, not just visible to the pool. Your score and raw features
  remain sealed permanently, but the coarse tier becomes public at borrow time. A production version would use
  lender-scoped decryption.
- rUSDC has an open mint (it is a faucet token), so pool economics are demonstrative.
- The operator can update model weights. Updates are versioned and evented onchain, but a production deployment would
  put the operator behind a timelock or governance.
- Self-reported features are the default in the demo; the attested sources shown in the UI are roadmap.

## Roadmap

- **Phase 1:** attested everything. zkTLS bank imports, Aave and Morpho history, signed payroll, EAS credentials,
  sybil-resistant identity binding
- **Phase 2:** a real credit market. Utilization-priced rates, a multi-lender marketplace consuming Redact verdicts
  permissionlessly, default records against encrypted identity, audited mainnet deployment
- **Phase 3:** one oracle, many doors. Insurance underwriting, rental screening, hiring pre-checks, and
  reputation-weighted governance, all on the same primitive: an AI decision computed on data nobody can read

## Stack

Zama FHEVM v0.11 (Solidity 0.8.24), `@zama-fhe/relayer-sdk` for client side encryption and the self-relaying decryption
flow, Hardhat, React + Vite + wagmi + RainbowKit, scikit-learn for model training.

## License

BSD-3-Clause-Clear
