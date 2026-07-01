"""
Redact model training.

Generates a synthetic consumer credit dataset calibrated to published
credit-risk relationships (default likelihood rises with DTI and recent
inquiries, falls with income, payment history, credit age, tenure), trains
a logistic regression on it, and quantizes the coefficients into the
split positive/negative uint32 fixed-point format used by Redact.sol.

The same script accepts a real CSV (e.g. Lending Club) with the columns:
  income_tier, dti, on_time_payments, credit_history_months,
  open_accounts, recent_inquiries, employment_months, wallet_age_months,
  defaulted (0/1)

Usage:
  python train_weights.py            # synthetic calibrated dataset
  python train_weights.py data.csv   # your own dataset
"""

import sys
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, accuracy_score

RNG = np.random.default_rng(42)
N = 50_000

FEATURES = [
    "income_tier",            # 0-10
    "dti",                    # 0-100
    "on_time_payments",       # 0-100
    "credit_history_months",  # 0-600
    "open_accounts",          # 0-30
    "recent_inquiries",       # 0-20
    "employment_months",      # 0-600
    "wallet_age_months",      # 0-200
]

# Fixed-point scale used onchain. Weights and threshold are multiplied by this.
SCALE = 1000


def generate_calibrated_dataset(n: int) -> pd.DataFrame:
    """Synthesize a dataset with credit-risk relationships calibrated to
    published consumer lending statistics (directionally faithful)."""
    income_tier = RNG.integers(0, 11, n)
    dti = np.clip(RNG.normal(35, 18, n), 0, 100)
    on_time = np.clip(RNG.normal(55, 25, n), 0, 100).astype(int)
    history = np.clip(RNG.exponential(140, n), 0, 600).astype(int)
    open_acc = np.clip(RNG.poisson(8, n), 0, 30)
    inquiries = np.clip(RNG.poisson(2.2, n), 0, 20)
    employment = np.clip(RNG.exponential(90, n), 0, 600).astype(int)
    wallet_age = np.clip(RNG.exponential(30, n), 0, 200).astype(int)

    # Latent default propensity. Signs follow the classic credit-risk relationships:
    # higher DTI and inquiries increase risk; income, payment history, credit age,
    # tenure, wallet age all decrease it. Magnitudes chosen to give a realistic
    # base default rate near 20 percent, similar to unsecured personal lending books.
    logit = (
        1.10
        - 0.30 * income_tier
        + 0.045 * dti
        - 0.035 * on_time
        - 0.004 * history
        + 0.020 * open_acc
        + 0.16 * inquiries
        - 0.003 * employment
        - 0.006 * wallet_age
        + RNG.normal(0, 0.9, n)  # idiosyncratic noise
    )
    p_default = 1 / (1 + np.exp(-logit))
    defaulted = (RNG.random(n) < p_default).astype(int)

    return pd.DataFrame(
        {
            "income_tier": income_tier,
            "dti": dti.astype(int),
            "on_time_payments": on_time,
            "credit_history_months": history,
            "open_accounts": open_acc,
            "recent_inquiries": inquiries,
            "employment_months": employment,
            "wallet_age_months": wallet_age,
            "defaulted": defaulted,
        }
    )


def main() -> None:
    if len(sys.argv) > 1:
        df = pd.read_csv(sys.argv[1])
        source = sys.argv[1]
    else:
        df = generate_calibrated_dataset(N)
        source = f"synthetic calibrated dataset (n={N}, seed=42)"

    X = df[FEATURES].values.astype(float)
    # Target for the contract is APPROVAL, i.e. NOT defaulting.
    y = 1 - df["defaulted"].values

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    # No feature scaling on purpose: the contract consumes raw integer features,
    # so the model must be trained in raw feature space.
    clf = LogisticRegression(max_iter=5000, C=1.0)
    clf.fit(X_train, y_train)

    proba = clf.predict_proba(X_test)[:, 1]
    auc = roc_auc_score(y_test, proba)
    acc = accuracy_score(y_test, clf.predict(X_test))

    coefs = clf.coef_[0]
    intercept = clf.intercept_[0]

    print(f"Source:            {source}")
    print(f"Test AUC:          {auc:.4f}")
    print(f"Test accuracy:     {acc:.4f}")
    print(f"Base approval rate:{y.mean():.4f}")
    print()
    print("Raw coefficients:")
    for name, c in zip(FEATURES, coefs):
        print(f"  {name:24s} {c:+.6f}")
    print(f"  {'intercept':24s} {intercept:+.6f}")

    # ---- Quantization to the Redact onchain format ----
    # score = BIAS + sum(pos_w[i]*f[i]) - sum(neg_w[i]*f[i])   (all uint32)
    # approved iff score >= THRESHOLD
    #
    # Logistic approves iff  intercept + sum(coef*f) >= 0.
    # Multiply through by SCALE, split signs, and shift everything up by a
    # constant B so all quantities stay non-negative:
    #   BIAS      = B + round(SCALE*intercept)  if intercept > 0 else B
    #   THRESHOLD = B + round(SCALE*(-intercept)) if intercept < 0 else B
    q = np.round(coefs * SCALE).astype(np.int64)
    pos_w = np.where(q > 0, q, 0).astype(np.uint64)
    neg_w = np.where(q < 0, -q, 0).astype(np.uint64)

    B = 10_000  # headroom constant, keeps bias/threshold comfortably positive
    qi = int(round(intercept * SCALE))
    bias = B + max(qi, 0)
    threshold = B + max(-qi, 0)

    print()
    print("=" * 60)
    print("QUANTIZED ONCHAIN PARAMETERS (paste into updateModel task)")
    print("=" * 60)
    print(f"POS_WEIGHTS = {list(map(int, pos_w))}")
    print(f"NEG_WEIGHTS = {list(map(int, neg_w))}")
    print(f"BIAS        = {bias}")
    print(f"THRESHOLD   = {threshold}")

    # ---- Fidelity check: does the quantized integer model agree with sklearn? ----
    def quantized_approve(f: np.ndarray) -> np.ndarray:
        pos = bias + f @ pos_w.astype(np.int64)
        neg = threshold + f @ neg_w.astype(np.int64)
        return (pos >= neg).astype(int)

    q_pred = quantized_approve(X_test.astype(np.int64))
    agreement = (q_pred == clf.predict(X_test)).mean()
    q_acc = accuracy_score(y_test, q_pred)
    print()
    print(f"Quantized vs sklearn agreement: {agreement:.4f}")
    print(f"Quantized model test accuracy:  {q_acc:.4f}")

    # ---- Overflow check for euint32 ----
    # Worst-case feature vector maxes every feature.
    f_max = np.array([10, 100, 100, 600, 30, 20, 600, 200], dtype=np.int64)
    max_pos = bias + int(f_max @ pos_w.astype(np.int64))
    max_neg = threshold + int(f_max @ neg_w.astype(np.int64))
    assert max_pos < 2**32 and max_neg < 2**32, "euint32 overflow risk!"
    print(f"Max possible posSum: {max_pos:,} (euint32 max 4,294,967,295) OK")
    print(f"Max possible negSum: {max_neg:,} OK")


if __name__ == "__main__":
    main()
