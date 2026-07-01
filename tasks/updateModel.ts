import { task } from "hardhat/config";

/**
 * Update the live Redact model to the trained weights.
 *
 * Trained by scripts/train_weights.py:
 *   Test AUC 0.8098, accuracy 0.7640
 *   Quantized-vs-float agreement 0.9898
 *
 * Usage:
 *   npx hardhat update-model --network sepolia
 */
task("update-model", "Push the trained classifier weights to the deployed Redact contract").setAction(
  async (_args, hre) => {
    const { deployments, ethers } = hre;

    const POS_WEIGHTS = [260, 0, 30, 4, 0, 0, 2, 5];
    const NEG_WEIGHTS = [0, 40, 0, 0, 23, 144, 0, 0];
    const BIAS = 10000;
    const THRESHOLD = 10839;

    const deployment = await deployments.get("Redact");
    const redact = await ethers.getContractAt("Redact", deployment.address);
    const [operator] = await ethers.getSigners();

    console.log(`Redact at ${deployment.address}`);
    console.log(`Operator ${operator.address}`);
    console.log(`Current model version: ${await redact.modelVersion()}`);

    const tx = await redact.connect(operator).updateModel(POS_WEIGHTS, NEG_WEIGHTS, BIAS, THRESHOLD);
    console.log(`updateModel tx: ${tx.hash}`);
    await tx.wait();

    console.log(`New model version: ${await redact.modelVersion()}`);
    console.log(`New bias: ${await redact.bias()}, new threshold: ${await redact.threshold()}`);
    console.log("Done. The live classifier now runs the trained weights.");
  },
);
