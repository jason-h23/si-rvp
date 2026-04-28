/**
 * ZKDisputeGameProxy Contract Tests
 *
 * Tests the adapter that bridges IDisputeGame (Optimism Factory) to DisputeManager (SI-RVP).
 * Verifies initialization, setup, challenge flow, resolution, and view functions.
 *
 * @module test/ZKDisputeGameProxy.test.ts
 * @see contracts/src/ZKDisputeGameProxy.sol
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  ZKDisputeGameProxy,
  DisputeManager,
  RollupManager,
  ZKVerifier,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("ZKDisputeGameProxy", function () {
  let proxy: ZKDisputeGameProxy;
  let disputeManager: DisputeManager;
  let rollupManager: RollupManager;
  let zkVerifier: ZKVerifier;
  let deployer: HardhatEthersSigner;
  let sequencer: HardhatEthersSigner;
  let challenger: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  const BOND_AMOUNT = ethers.parseEther("0.01");
  const PROOF_DEADLINE = 60 * 60; // 1 hour

  const stateRoot1 = ethers.keccak256(ethers.toUtf8Bytes("state1"));
  const stateRoot2 = ethers.keccak256(ethers.toUtf8Bytes("state2"));

  beforeEach(async function () {
    [deployer, sequencer, challenger, other] = await ethers.getSigners();

    // Deploy core contracts
    const ZKVerifier = await ethers.getContractFactory("ZKVerifier");
    zkVerifier = await ZKVerifier.deploy();
    await zkVerifier.waitForDeployment();

    const RollupManager = await ethers.getContractFactory("RollupManager");
    rollupManager = await RollupManager.deploy(sequencer.address);
    await rollupManager.waitForDeployment();

    const DisputeManager = await ethers.getContractFactory("DisputeManager");
    disputeManager = await DisputeManager.deploy(
      await zkVerifier.getAddress(),
      await rollupManager.getAddress()
    );
    await disputeManager.waitForDeployment();

    // Wire up
    await rollupManager.setDisputeManager(await disputeManager.getAddress());

    // Sequencer proposes state root
    await rollupManager.connect(sequencer).proposeStateRoot(stateRoot1, 1);

    // Deploy ZKDisputeGameProxy (this is the implementation, not a clone)
    const Proxy = await ethers.getContractFactory("ZKDisputeGameProxy");
    proxy = await Proxy.deploy();
    await proxy.waitForDeployment();

    // Authorize the proxy in DisputeManager
    await disputeManager.addAuthorizedProxy(await proxy.getAddress());
  });

  describe("Initialization", function () {
    it("should initialize successfully", async function () {
      await proxy.initialize();
      expect(await proxy.status()).to.equal(0); // GameStatus.IN_PROGRESS
    });

    it("should reject double initialization", async function () {
      await proxy.initialize();
      await expect(proxy.initialize()).to.be.revertedWith(
        "ZKDisputeGameProxy: already initialized"
      );
    });

    it("should set createdAt timestamp", async function () {
      await proxy.initialize();
      const createdAt = await proxy.createdAt();
      expect(createdAt).to.be.gt(0);
    });
  });

  describe("Setup", function () {
    beforeEach(async function () {
      await proxy.initialize();
    });

    it("should set game parameters", async function () {
      const batchIndex = 1;
      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [batchIndex, await disputeManager.getAddress()]
      );

      await proxy.setup(stateRoot1, extraData, 100);

      expect(await proxy.rootClaim()).to.equal(stateRoot1);
      expect(await proxy.l2BlockNumber()).to.equal(100);
      expect(await proxy.disputeManager()).to.equal(
        await disputeManager.getAddress()
      );
    });

    it("should reject setup before initialize", async function () {
      const Proxy = await ethers.getContractFactory("ZKDisputeGameProxy");
      const freshProxy = await Proxy.deploy();
      await freshProxy.waitForDeployment();

      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [1, await disputeManager.getAddress()]
      );

      await expect(
        freshProxy.setup(stateRoot1, extraData, 100)
      ).to.be.revertedWith("ZKDisputeGameProxy: not factory");
    });

    it("should reject double setup", async function () {
      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [1, await disputeManager.getAddress()]
      );

      await proxy.setup(stateRoot1, extraData, 100);

      await expect(
        proxy.setup(stateRoot2, extraData, 200)
      ).to.be.revertedWith("ZKDisputeGameProxy: already setup");
    });
  });

  describe("Challenge", function () {
    beforeEach(async function () {
      await proxy.initialize();

      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [1, await disputeManager.getAddress()]
      );
      await proxy.setup(stateRoot1, extraData, 100);
    });

    it("should forward challenge to DisputeManager", async function () {
      const tx = await proxy
        .connect(challenger)
        .challenge(stateRoot2, { value: BOND_AMOUNT });

      // Verify dispute was created in DisputeManager
      const disputeId = await proxy.disputeId();
      expect(disputeId).to.equal(1);

      // Verify the challenger is recorded correctly (not the proxy)
      const dispute = await disputeManager.getDispute(disputeId);
      expect(dispute.challenger).to.equal(challenger.address);
      expect(dispute.batchIndex).to.equal(1);
    });

    it("should emit DisputeInitiated on DisputeManager", async function () {
      await expect(
        proxy
          .connect(challenger)
          .challenge(stateRoot2, { value: BOND_AMOUNT })
      )
        .to.emit(disputeManager, "DisputeInitiated")
        .withArgs(1, 1, challenger.address, stateRoot2);
    });

    it("should reject challenge with insufficient bond", async function () {
      await expect(
        proxy
          .connect(challenger)
          .challenge(stateRoot2, { value: BOND_AMOUNT - 1n })
      ).to.be.revertedWith("DisputeManager: insufficient bond");
    });

    it("should reject duplicate challenge", async function () {
      await proxy
        .connect(challenger)
        .challenge(stateRoot2, { value: BOND_AMOUNT });

      await expect(
        proxy
          .connect(other)
          .challenge(stateRoot2, { value: BOND_AMOUNT })
      ).to.be.revertedWith("ZKDisputeGameProxy: already challenged");
    });
  });

  describe("Resolution", function () {
    it("should reject resolve before challenge", async function () {
      await proxy.initialize();

      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [1, await disputeManager.getAddress()]
      );
      await proxy.setup(stateRoot1, extraData, 100);

      await expect(proxy.resolve()).to.be.revertedWith(
        "ZKDisputeGameProxy: not challenged"
      );
    });

    it("should reject resolve when dispute not resolved in DisputeManager", async function () {
      await proxy.initialize();

      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [1, await disputeManager.getAddress()]
      );
      await proxy.setup(stateRoot1, extraData, 100);

      await proxy
        .connect(challenger)
        .challenge(stateRoot2, { value: BOND_AMOUNT });

      await expect(proxy.resolve()).to.be.revertedWith(
        "ZKDisputeGameProxy: dispute not resolved"
      );
    });

    it("should resolve as CHALLENGER_WINS on timeout", async function () {
      await proxy.initialize();

      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [1, await disputeManager.getAddress()]
      );
      await proxy.setup(stateRoot1, extraData, 100);

      await proxy
        .connect(challenger)
        .challenge(stateRoot2, { value: BOND_AMOUNT });

      // Fast-forward past proof deadline
      await time.increase(PROOF_DEADLINE + 1);

      // Trigger timeout in DisputeManager
      await disputeManager.triggerTimeout(1);

      // Now resolve the game
      await expect(proxy.resolve())
        .to.emit(proxy, "Resolved")
        .withArgs(1); // GameStatus.CHALLENGER_WINS

      expect(await proxy.status()).to.equal(1); // CHALLENGER_WINS
    });
  });

  describe("View Functions", function () {
    it("should return correct gameType (ZK_CANNON = 255)", async function () {
      expect(await proxy.gameType()).to.equal(255);
    });

    it("should return zkVerifier address from DisputeManager", async function () {
      await proxy.initialize();

      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [1, await disputeManager.getAddress()]
      );
      await proxy.setup(stateRoot1, extraData, 100);

      expect(await proxy.zkVerifier()).to.equal(
        await zkVerifier.getAddress()
      );
    });

    it("should return extraData", async function () {
      await proxy.initialize();

      const expectedExtraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [1, await disputeManager.getAddress()]
      );
      await proxy.setup(stateRoot1, expectedExtraData, 100);

      expect(await proxy.extraData()).to.equal(expectedExtraData);
    });
  });
});
