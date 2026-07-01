import { Redact, Redact__factory } from "../types";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

// Match the placeholder weights in deploy/01_deploy_redact.ts
const POS_WEIGHTS: number[] = [500, 0, 40, 5, 0, 0, 8, 15];
const NEG_WEIGHTS: number[] = [0, 30, 0, 0, 20, 100, 0, 0];
const BIAS = 2000;
const THRESHOLD = 4000;

async function deployFixture() {
  const factory = (await ethers.getContractFactory("Redact")) as Redact__factory;
  const redact = (await factory.deploy(POS_WEIGHTS, NEG_WEIGHTS, BIAS, THRESHOLD)) as Redact;
  const address = await redact.getAddress();
  return { redact, address };
}

// Compute what the plaintext score should be, matching the contract formula:
//   posSum = bias + sum(posW[i] * f[i])
//   negSum = sum(negW[i] * f[i])
//   approved = posSum >= negSum + threshold
function expectedResult(features: number[]): { score: number; approved: boolean } {
  let posSum = BIAS;
  let negSum = 0;
  for (let i = 0; i < features.length; i++) {
    posSum += POS_WEIGHTS[i] * features[i];
    negSum += NEG_WEIGHTS[i] * features[i];
  }
  return { score: posSum, approved: posSum >= negSum + THRESHOLD };
}

describe("Redact", function () {
  let signers: Signers;
  let redact: Redact;
  let address: string;

  before(async function () {
    if (!fhevm.isMock) {
      console.warn("Skipping mock suite on a live network. Use test/RedactSepolia.ts for Sepolia.");
      this.skip();
    }
    const s = await ethers.getSigners();
    signers = { deployer: s[0], alice: s[1], bob: s[2] };
  });

  beforeEach(async function () {
    ({ redact, address } = await deployFixture());
  });

  it("initializes with the given model params", async function () {
    expect(await redact.modelVersion()).to.eq(1n);
    expect(await redact.bias()).to.eq(BIAS);
    expect(await redact.threshold()).to.eq(THRESHOLD);
    expect(await redact.operator()).to.eq(signers.deployer.address);
  });

  it("approves a strong applicant", async function () {
    // A great applicant: high income, low debt, many on-time payments, long history
    const features = [10, 5, 90, 400, 3, 0, 240, 60];
    const { approved } = expectedResult(features);
    expect(approved).to.eq(true);

    const input = fhevm.createEncryptedInput(address, signers.alice.address);
    for (const f of features) input.add32(f);
    const enc = await input.encrypt();

    const tx = await redact.connect(signers.alice).submitApplication(enc.handles, enc.inputProof);
    await tx.wait();

    const encVerdict = await redact.connect(signers.alice).getMyVerdict();
    const verdict = await fhevm.userDecryptEbool(encVerdict, address, signers.alice);
    expect(verdict).to.eq(true);
  });

  it("rejects a weak applicant", async function () {
    // A weak applicant: low income, high debt, few payments, short history, many inquiries
    const features = [1, 90, 2, 6, 20, 15, 3, 4];
    const { approved } = expectedResult(features);
    expect(approved).to.eq(false);

    const input = fhevm.createEncryptedInput(address, signers.alice.address);
    for (const f of features) input.add32(f);
    const enc = await input.encrypt();

    const tx = await redact.connect(signers.alice).submitApplication(enc.handles, enc.inputProof);
    await tx.wait();

    const encVerdict = await redact.connect(signers.alice).getMyVerdict();
    const verdict = await fhevm.userDecryptEbool(encVerdict, address, signers.alice);
    expect(verdict).to.eq(false);
  });

  it("returns the same encrypted score the classifier computed", async function () {
    const features = [8, 20, 60, 120, 5, 2, 60, 24];
    const { score } = expectedResult(features);

    const input = fhevm.createEncryptedInput(address, signers.alice.address);
    for (const f of features) input.add32(f);
    const enc = await input.encrypt();

    await (await redact.connect(signers.alice).submitApplication(enc.handles, enc.inputProof)).wait();

    const encScore = await redact.connect(signers.alice).getMyScore();
    const clearScore = await fhevm.userDecryptEuint(FhevmType.euint32, encScore, address, signers.alice);
    expect(clearScore).to.eq(BigInt(score));
  });

  it("blocks reads before an application exists", async function () {
    await expect(redact.connect(signers.bob).getMyScore()).to.be.revertedWith("Redact: no application");
  });

  it("lets an applicant authorize a lender", async function () {
    const features = [10, 5, 90, 400, 3, 0, 240, 60];
    const input = fhevm.createEncryptedInput(address, signers.alice.address);
    for (const f of features) input.add32(f);
    const enc = await input.encrypt();
    await (await redact.connect(signers.alice).submitApplication(enc.handles, enc.inputProof)).wait();

    await expect(redact.connect(signers.alice).authorizeLender(signers.bob.address))
      .to.emit(redact, "LenderAuthorized")
      .withArgs(signers.alice.address, signers.bob.address);
  });

  it("only the operator can update the model", async function () {
    const newPos = [600, 0, 50, 6, 0, 0, 10, 20];
    const newNeg = [0, 40, 0, 0, 25, 120, 0, 0];
    await expect(redact.connect(signers.alice).updateModel(newPos, newNeg, 2500, 5000)).to.be.revertedWith(
      "Redact: caller is not the operator",
    );

    await expect(redact.connect(signers.deployer).updateModel(newPos, newNeg, 2500, 5000))
      .to.emit(redact, "ModelUpdated")
      .withArgs(2n);

    expect(await redact.modelVersion()).to.eq(2n);
    expect(await redact.bias()).to.eq(2500n);
    expect(await redact.threshold()).to.eq(5000n);
  });
});
