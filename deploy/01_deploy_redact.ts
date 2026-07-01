import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Placeholder model weights for Day 1 deployment.
 *
 * These are handpicked plausible weights that behave like a real logistic
 * regression. They will be replaced on Day 2 with weights trained on the
 * Lending Club public credit dataset. The weight semantics match the feature
 * encoding in contracts/Redact.sol:
 *
 *   0: annual income tier      (positive contributor)
 *   1: debt-to-income ratio    (negative contributor)
 *   2: on-time payment count   (positive contributor)
 *   3: months of credit history (positive contributor)
 *   4: number of open accounts (small negative when high)
 *   5: recent inquiries        (negative contributor)
 *   6: employment tenure       (positive contributor)
 *   7: wallet age              (positive contributor)
 *
 * All weights are scaled by 1000 (fixed-point). Threshold is also scaled.
 */
const POS_WEIGHTS: number[] = [500, 0, 40, 5, 0, 0, 8, 15];
const NEG_WEIGHTS: number[] = [0, 30, 0, 0, 20, 100, 0, 0];
const BIAS: number = 2000;
const THRESHOLD: number = 4000;
const MAX_LOAN: bigint = 10_000n * 10n ** 6n; // 10,000 with 6 decimals (mimics USDC)

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  log(`\n=== Deploying Redact from ${deployer} ===`);

  const redact = await deploy("Redact", {
    from: deployer,
    args: [POS_WEIGHTS, NEG_WEIGHTS, BIAS, THRESHOLD],
    log: true,
    waitConfirmations: hre.network.name === "sepolia" ? 2 : 1,
  });
  log(`Redact deployed: ${redact.address}`);

  const pool = await deploy("RedactLendingPool", {
    from: deployer,
    args: [redact.address, MAX_LOAN],
    log: true,
    waitConfirmations: hre.network.name === "sepolia" ? 2 : 1,
  });
  log(`RedactLendingPool deployed: ${pool.address}`);

  log(`\n=== Deployment summary ===`);
  log(`Redact:            ${redact.address}`);
  log(`RedactLendingPool: ${pool.address}`);
  log(`Model version:     1 (placeholder weights)`);
  log(`Max loan per user: ${MAX_LOAN.toString()}`);
  log(`==========================\n`);
};

export default func;
func.id = "deploy_redact";
func.tags = ["Redact", "RedactLendingPool"];
