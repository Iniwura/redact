import { Redact, Redact__factory, RedactUSD, RedactUSD__factory } from "../types";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

// Trained model, matches deploy/01_deploy_redact.ts
const POS_WEIGHTS: number[] = [260, 0, 30, 4, 0, 0, 2, 5];
const NEG_WEIGHTS: number[] = [0, 40, 0, 0, 23, 144, 0, 0];
const BIAS = 10000;
const THRESHOLD = 10839;
const MARGIN_SILVER = 2000;
const MARGIN_GOLD = 5000;

async function deployFixture() {
  const factory = (await ethers.getContractFactory("Redact")) as Redact__factory;
  const redact = (await factory.deploy(POS_WEIGHTS, NEG_WEIGHTS, BIAS, THRESHOLD)) as Redact;
  const address = await redact.getAddress();
  return { redact, address };
}

function expectedResult(features: number[]): { score: number; approved: boolean; tier: number } {
  let posSum = BIAS;
  let negSum = THRESHOLD;
  for (let i = 0; i < features.length; i++) {
    posSum += POS_WEIGHTS[i] * features[i];
    negSum += NEG_WEIGHTS[i] * features[i];
  }
  const approved = posSum >= negSum;
  let tier = 0;
  if (posSum >= negSum + MARGIN_GOLD) tier = 3;
  else if (posSum >= negSum + MARGIN_SILVER) tier = 2;
  else if (approved) tier = 1;
  return { score: posSum, approved, tier };
}

describe("Redact v2", function () {
  let signers: Signers;
  let redact: Redact;
  let address: string;

  before(async function () {
    if (!fhevm.isMock) {
      console.warn("Skipping mock suite on a live network.");
      this.skip();
    }
    const s = await ethers.getSigners();
    signers = { deployer: s[0], alice: s[1], bob: s[2] };
  });

  beforeEach(async function () {
    ({ redact, address } = await deployFixture());
  });

  async function submit(features: number[], as: HardhatEthersSigner) {
    const input = fhevm.createEncryptedInput(address, as.address);
    for (const f of features) input.add32(f);
    const enc = await input.encrypt();
    const tx = await redact.connect(as).submitApplication(enc.handles, enc.inputProof);
    await tx.wait();
  }

  it("gold tier for a strong applicant", async function () {
    const features = [10, 5, 90, 400, 3, 0, 240, 60];
    const exp = expectedResult(features);
    expect(exp.tier).to.eq(3);

    await submit(features, signers.alice);

    const encTier = await redact.connect(signers.alice).getMyTier();
    const tier = await fhevm.userDecryptEuint(FhevmType.euint32, encTier, address, signers.alice);
    expect(tier).to.eq(3n);

    const encVerdict = await redact.connect(signers.alice).getMyVerdict();
    expect(await fhevm.userDecryptEbool(encVerdict, address, signers.alice)).to.eq(true);

    const encScore = await redact.connect(signers.alice).getMyScore();
    const score = await fhevm.userDecryptEuint(FhevmType.euint32, encScore, address, signers.alice);
    expect(score).to.eq(BigInt(exp.score));
  });

  it("tier 0 rejection for a weak applicant", async function () {
    const features = [1, 90, 2, 6, 20, 15, 3, 4];
    const exp = expectedResult(features);
    expect(exp.tier).to.eq(0);

    await submit(features, signers.alice);

    const encTier = await redact.connect(signers.alice).getMyTier();
    const tier = await fhevm.userDecryptEuint(FhevmType.euint32, encTier, address, signers.alice);
    expect(tier).to.eq(0n);

    const encVerdict = await redact.connect(signers.alice).getMyVerdict();
    expect(await fhevm.userDecryptEbool(encVerdict, address, signers.alice)).to.eq(false);
  });

  it("middle tier for a middling applicant", async function () {
    // Aim for tier 1 or 2: decent but not stellar profile.
    const features = [6, 30, 55, 150, 8, 2, 80, 24];
    const exp = expectedResult(features);
    expect(exp.tier).to.be.oneOf([1, 2]);

    await submit(features, signers.alice);

    const encTier = await redact.connect(signers.alice).getMyTier();
    const tier = await fhevm.userDecryptEuint(FhevmType.euint32, encTier, address, signers.alice);
    expect(tier).to.eq(BigInt(exp.tier));
  });

  it("authorizeLender grants tier access", async function () {
    const features = [10, 5, 90, 400, 3, 0, 240, 60];
    await submit(features, signers.alice);

    await expect(redact.connect(signers.alice).authorizeLender(signers.bob.address))
      .to.emit(redact, "LenderAuthorized")
      .withArgs(signers.alice.address, signers.bob.address);
  });

  it("only the operator can update the model", async function () {
    await expect(
      redact.connect(signers.alice).updateModel(POS_WEIGHTS, NEG_WEIGHTS, BIAS, THRESHOLD),
    ).to.be.revertedWith("Redact: caller is not the operator");
  });
});

describe("RedactUSD", function () {
  before(async function () {
    if (!fhevm.isMock) this.skip();
  });

  it("mints and transfers", async function () {
    const [a, b] = await ethers.getSigners();
    const factory = (await ethers.getContractFactory("RedactUSD")) as RedactUSD__factory;
    const usdc = (await factory.deploy()) as RedactUSD;
    await (await usdc.mint(a.address, 1000_000000n)).wait();
    expect(await usdc.balanceOf(a.address)).to.eq(1000_000000n);
    await (await usdc.transfer(b.address, 400_000000n)).wait();
    expect(await usdc.balanceOf(b.address)).to.eq(400_000000n);
  });
});
