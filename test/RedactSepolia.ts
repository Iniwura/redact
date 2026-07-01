import { Redact } from "../types";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm, deployments } from "hardhat";
import * as hre from "hardhat";

/**
 * Sepolia end-to-end test for Redact.
 *
 * Unlike test/Redact.ts (mock mode, fresh deploy per test), this suite:
 *  - runs ONLY on Sepolia (skips itself in mock mode)
 *  - attaches to the ALREADY DEPLOYED contract from hardhat-deploy's records
 *  - uses only the funded deployer account
 *  - runs one full encrypted round trip: encrypt features client-side,
 *    submit onchain, classifier runs under real FHE, decrypt the verdict
 *    and the score back through the real relayer.
 *
 * Run with: npx hardhat test test/RedactSepolia.ts --network sepolia
 */
describe("Redact (Sepolia live)", function () {
  // Real FHE + Sepolia blocks are slow. 10 minutes of headroom.
  this.timeout(600_000);

  let redact: Redact;
  let redactAddress: string;
  let deployer: HardhatEthersSigner;

  before(async function () {
    if (fhevm.isMock) {
      console.warn("Skipping Sepolia suite: running in mock mode. Use --network sepolia.");
      this.skip();
    }

    const signers = await ethers.getSigners();
    deployer = signers[0];

    const deployment = await deployments.get("Redact");
    redactAddress = deployment.address;
    redact = (await ethers.getContractAt("Redact", redactAddress)) as unknown as Redact;

    console.log(`Attached to Redact at ${redactAddress}`);
    console.log(`Using deployer ${deployer.address}`);
  });

  it("runs a full encrypted application round trip on real FHE", async function () {
    // Strong applicant profile: should be approved under the placeholder weights.
    const features = [10, 5, 90, 400, 3, 0, 240, 60];

    console.log("Encrypting 8 features client-side via the Zama relayer...");
    const input = fhevm.createEncryptedInput(redactAddress, deployer.address);
    for (const f of features) input.add32(f);
    const enc = await input.encrypt();
    console.log("Encrypted. Submitting application onchain...");

    const tx = await redact.connect(deployer).submitApplication(enc.handles, enc.inputProof);
    const receipt = await tx.wait();
    console.log(`Application submitted in tx ${receipt?.hash}`);

    expect(await redact.applicationExists(deployer.address)).to.eq(true);

    console.log("Decrypting the verdict through the relayer (user decryption)...");
    const encVerdict = await redact.connect(deployer).getMyVerdict();
    const verdict = await fhevm.userDecryptEbool(encVerdict, redactAddress, deployer);
    console.log(`Decrypted verdict: ${verdict ? "APPROVED" : "REJECTED"}`);
    expect(verdict).to.eq(true);

    console.log("Decrypting the raw score...");
    const encScore = await redact.connect(deployer).getMyScore();
    const clearScore = await fhevm.userDecryptEuint(FhevmType.euint32, encScore, redactAddress, deployer);
    console.log(`Decrypted score: ${clearScore}`);

    // Expected: bias 2000 + 500*10 + 40*90 + 5*400 + 8*240 + 15*60 = 15420
    expect(clearScore).to.eq(15420n);
  });

  it("reads public state correctly", async function () {
    expect(await redact.modelVersion()).to.be.gte(1n);
    const total = await redact.totalApplications();
    console.log(`Total applications so far: ${total}`);
    expect(total).to.be.gte(1n);
  });
});
