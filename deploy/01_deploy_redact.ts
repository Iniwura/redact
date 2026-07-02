import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Redact v2 deployment.
 *
 * Weights are the TRAINED model from scripts/train_weights.py:
 *   Test AUC 0.8098, accuracy 0.7640, quantized agreement 0.9898.
 * Deploys as model version 1 of the v2 contracts.
 *
 * Also deploys the rUSDC demo token and funds the lending pool with 1,000,000.
 */
const POS_WEIGHTS: number[] = [260, 0, 30, 4, 0, 0, 2, 5];
const NEG_WEIGHTS: number[] = [0, 40, 0, 0, 23, 144, 0, 0];
const BIAS: number = 10000;
const THRESHOLD: number = 10839;

const POOL_FUNDING: bigint = 1_000_000n * 10n ** 6n; // 1M rUSDC

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  log(`\n=== Deploying Redact v2 from ${deployer} ===`);

  const usdc = await deploy("RedactUSD", {
    from: deployer,
    args: [],
    log: true,
    waitConfirmations: hre.network.name === "sepolia" ? 2 : 1,
  });

  const redact = await deploy("Redact", {
    from: deployer,
    args: [POS_WEIGHTS, NEG_WEIGHTS, BIAS, THRESHOLD],
    log: true,
    waitConfirmations: hre.network.name === "sepolia" ? 2 : 1,
  });

  const pool = await deploy("RedactLendingPool", {
    from: deployer,
    args: [redact.address, usdc.address],
    log: true,
    waitConfirmations: hre.network.name === "sepolia" ? 2 : 1,
  });

  // Fund the pool with rUSDC liquidity.
  const token = await ethers.getContractAt("RedactUSD", usdc.address);
  const poolBalance = await token.balanceOf(pool.address);
  if (poolBalance < POOL_FUNDING) {
    log(`Funding pool with ${POOL_FUNDING} rUSDC...`);
    const tx = await token.mint(pool.address, POOL_FUNDING);
    await tx.wait();
    log(`Pool funded.`);
  }

  log(`\n=== Deployment summary (v2) ===`);
  log(`rUSDC token:       ${usdc.address}`);
  log(`Redact oracle:     ${redact.address}`);
  log(`RedactLendingPool: ${pool.address}`);
  log(`Model:             trained weights (AUC 0.81), version 1`);
  log(`Pool liquidity:    1,000,000 rUSDC`);
  log(`Tiers:             1=500, 2=1000, 3=2500 rUSDC | 5% interest | 30d term`);
  log(`================================\n`);
};

export default func;
func.id = "deploy_redact_v2";
func.tags = ["RedactV2"];
