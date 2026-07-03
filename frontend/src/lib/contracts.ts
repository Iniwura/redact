// v2 deployment addresses. PASTE THE NEW ADDRESSES HERE after running
// `npx hardhat deploy --network sepolia` (they print in the summary).
export const REDACT_ADDRESS = "0xc3f4d0cBA1E1b4813C36a896C16961EFFee180AD" as `0x${string}`;
export const POOL_ADDRESS = "0x0e4eC1B0158615D6F266C8936198B71b357Ab45a" as `0x${string}`;
export const USDC_ADDRESS = "0x16107239DE7017a9DFc99dD30d7A7b8e0058fe35" as `0x${string}`;

export const REDACT_ABI = [
  {
    inputs: [
      { internalType: "externalEuint32[8]", name: "encryptedFeatures", type: "bytes32[8]" },
      { internalType: "bytes", name: "inputProof", type: "bytes" },
    ],
    name: "submitApplication",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "getMyScore",
    outputs: [{ internalType: "euint32", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getMyVerdict",
    outputs: [{ internalType: "ebool", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getMyTier",
    outputs: [{ internalType: "euint32", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "user", type: "address" }],
    name: "applicationExists",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "lender", type: "address" }],
    name: "authorizeLender",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "modelVersion",
    outputs: [{ internalType: "uint32", name: "", type: "uint32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalApplications",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "user", type: "address" }],
    name: "applicationTimestamp",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const POOL_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "borrower", type: "address" },
      { indexed: false, internalType: "bytes32", name: "tierHandle", type: "bytes32" },
    ],
    name: "LoanRequested",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "borrower", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "LoanRepaid",
    type: "event",
  },
  {
    inputs: [],
    name: "requestLoan",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "borrower", type: "address" },
      { internalType: "bytes", name: "abiEncodedClearTier", type: "bytes" },
      { internalType: "bytes", name: "decryptionProof", type: "bytes" },
    ],
    name: "finalizeLoan",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "pending",
    outputs: [
      { internalType: "uint256", name: "requestedAt", type: "uint256" },
      { internalType: "euint32", name: "tierHandle", type: "bytes32" },
      { internalType: "bool", name: "exists", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "loans",
    outputs: [
      { internalType: "uint256", name: "principal", type: "uint256" },
      { internalType: "uint256", name: "amountDue", type: "uint256" },
      { internalType: "uint256", name: "dueAt", type: "uint256" },
      { internalType: "uint8", name: "tier", type: "uint8" },
      { internalType: "bool", name: "active", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "repay",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "liquidity",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalLoansIssued",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalLoansRejected",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const ERC20_ABI = [
  {
    inputs: [{ internalType: "address", name: "who", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "spender", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "mint",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const TIER_INFO = [
  { name: "REJECTED", loan: 0, color: "red" },
  { name: "BRONZE", loan: 500, color: "bronze" },
  { name: "SILVER", loan: 1000, color: "silver" },
  { name: "GOLD", loan: 2500, color: "gold" },
] as const;

export const FEATURES = [
  { key: "income_tier", label: "Annual income tier", min: 0, max: 10, default: 5, hint: "0 = lowest, 10 = highest", attested: false },
  { key: "dti", label: "Debt-to-income ratio", min: 0, max: 100, default: 35, hint: "percent", attested: false },
  { key: "on_time_payments", label: "On-time payments", min: 0, max: 100, default: 50, hint: "count", attested: false },
  { key: "credit_history_months", label: "Credit history", min: 0, max: 600, default: 120, hint: "months", attested: false },
  { key: "open_accounts", label: "Open accounts", min: 0, max: 30, default: 8, hint: "count", attested: false },
  { key: "recent_inquiries", label: "Recent inquiries", min: 0, max: 20, default: 2, hint: "last 12 months", attested: false },
  { key: "employment_months", label: "Employment tenure", min: 0, max: 600, default: 60, hint: "months", attested: false },
  { key: "wallet_activity", label: "Onchain activity", min: 0, max: 200, default: 0, hint: "attested from chain", attested: true },
] as const;
