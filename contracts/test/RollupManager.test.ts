/**
 * RollupManager Contract Tests
 *
 * Unit tests for the RollupManager smart contract which manages L2 state roots
 * and batch submissions in the optimistic rollup system.
 *
 * Test Coverage:
 * - Batch proposal and state root management
 * - Finalization after challenge period
 * - Batch invalidation during disputes
 * - Access control for sequencer operations
 *
 * The RollupManager is the entry point for the rollup protocol, coordinating
 * with DisputeManager for dispute resolution.
 *
 * @module test/RollupManager.test.ts
 * @see contracts/src/RollupManager.sol
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { RollupManager } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("RollupManager", function () {
  let rollupManager: RollupManager;
  let sequencer: HardhatEthersSigner;
  let challenger: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  const CHALLENGE_PERIOD = 10 * 60; // 10 minutes in seconds
  const GENESIS_STATE_ROOT = ethers.ZeroHash;

  beforeEach(async function () {
    [sequencer, challenger, other] = await ethers.getSigners();

    const RollupManager = await ethers.getContractFactory("RollupManager");
    rollupManager = await RollupManager.deploy(sequencer.address);
    await rollupManager.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set correct sequencer", async function () {
      expect(await rollupManager.sequencer()).to.equal(sequencer.address);
    });

    it("should initialize genesis batch", async function () {
      const batch = await rollupManager.getBatch(0);
      expect(batch.stateRoot).to.equal(GENESIS_STATE_ROOT);
      expect(batch.status).to.equal(1); // BatchStatus.Finalized
    });

    it("should start with latestBatchIndex = 0", async function () {
      expect(await rollupManager.latestBatchIndex()).to.equal(0);
    });

    it("should start with latestFinalizedBatchIndex = 0", async function () {
      expect(await rollupManager.latestFinalizedBatchIndex()).to.equal(0);
    });
  });

  describe("proposeStateRoot", function () {
    const stateRoot = ethers.keccak256(ethers.toUtf8Bytes("state1"));

    it("should allow sequencer to propose state root", async function () {
      await expect(rollupManager.connect(sequencer).proposeStateRoot(stateRoot, 1))
        .to.emit(rollupManager, "StateRootProposed")
        .withArgs(1, stateRoot, GENESIS_STATE_ROOT, sequencer.address);

      expect(await rollupManager.latestBatchIndex()).to.equal(1);
    });

    it("should reject non-sequencer", async function () {
      await expect(
        rollupManager.connect(other).proposeStateRoot(stateRoot, 1)
      ).to.be.revertedWith("RollupManager: not sequencer");
    });

    it("should reject invalid batch index", async function () {
      await expect(
        rollupManager.connect(sequencer).proposeStateRoot(stateRoot, 2)
      ).to.be.revertedWith("RollupManager: invalid batch index");
    });

    it("should reject zero state root", async function () {
      await expect(
        rollupManager.connect(sequencer).proposeStateRoot(ethers.ZeroHash, 1)
      ).to.be.revertedWith("RollupManager: invalid state root");
    });

    it("should store batch correctly", async function () {
      await rollupManager.connect(sequencer).proposeStateRoot(stateRoot, 1);

      const batch = await rollupManager.getBatch(1);
      expect(batch.stateRoot).to.equal(stateRoot);
      expect(batch.prevStateRoot).to.equal(GENESIS_STATE_ROOT);
      expect(batch.proposer).to.equal(sequencer.address);
      expect(batch.status).to.equal(0); // BatchStatus.Pending
    });
  });

  describe("finalizeBatch", function () {
    const stateRoot = ethers.keccak256(ethers.toUtf8Bytes("state1"));

    beforeEach(async function () {
      await rollupManager.connect(sequencer).proposeStateRoot(stateRoot, 1);
    });

    it("should finalize batch after challenge period", async function () {
      await time.increase(CHALLENGE_PERIOD + 1);

      await expect(rollupManager.finalizeBatch(1))
        .to.emit(rollupManager, "BatchFinalized")
        .withArgs(1, stateRoot);

      const batch = await rollupManager.getBatch(1);
      expect(batch.status).to.equal(1); // BatchStatus.Finalized
    });

    it("should update latestFinalizedBatchIndex", async function () {
      await time.increase(CHALLENGE_PERIOD + 1);
      await rollupManager.finalizeBatch(1);

      expect(await rollupManager.latestFinalizedBatchIndex()).to.equal(1);
    });

    it("should reject before challenge period ends", async function () {
      await expect(rollupManager.finalizeBatch(1)).to.be.revertedWith(
        "RollupManager: challenge period not ended"
      );
    });

    it("should reject finalization out of order", async function () {
      const stateRoot2 = ethers.keccak256(ethers.toUtf8Bytes("state2"));
      await rollupManager.connect(sequencer).proposeStateRoot(stateRoot2, 2);

      await time.increase(CHALLENGE_PERIOD + 1);

      await expect(rollupManager.finalizeBatch(2)).to.be.revertedWith(
        "RollupManager: must finalize in order"
      );
    });
  });

  describe("setDisputeManager", function () {
    it("should set dispute manager", async function () {
      await rollupManager.setDisputeManager(challenger.address);
      expect(await rollupManager.disputeManager()).to.equal(challenger.address);
    });

    it("should reject setting twice", async function () {
      await rollupManager.setDisputeManager(challenger.address);
      await expect(
        rollupManager.setDisputeManager(other.address)
      ).to.be.revertedWith("RollupManager: already set");
    });

    it("should reject non-owner", async function () {
      await expect(
        rollupManager.connect(other).setDisputeManager(challenger.address)
      ).to.be.revertedWithCustomError(rollupManager, "OwnableUnauthorizedAccount");
    });

    it("should reject zero address", async function () {
      await expect(
        rollupManager.setDisputeManager(ethers.ZeroAddress)
      ).to.be.revertedWith("RollupManager: zero address");
    });
  });

  describe("Dispute Manager Functions", function () {
    const stateRoot = ethers.keccak256(ethers.toUtf8Bytes("state1"));

    beforeEach(async function () {
      await rollupManager.setDisputeManager(challenger.address);
      await rollupManager.connect(sequencer).proposeStateRoot(stateRoot, 1);
    });

    it("should mark batch as disputed", async function () {
      await rollupManager.connect(challenger).markDisputed(1);

      const batch = await rollupManager.getBatch(1);
      expect(batch.status).to.equal(2); // BatchStatus.Disputed
    });

    it("should reject batch on challenger win", async function () {
      await rollupManager.connect(challenger).markDisputed(1);

      await expect(rollupManager.connect(challenger).rejectBatch(1))
        .to.emit(rollupManager, "BatchRejected")
        .withArgs(1, stateRoot);

      const batch = await rollupManager.getBatch(1);
      expect(batch.status).to.equal(3); // BatchStatus.Rejected
    });

    it("should confirm batch on sequencer win", async function () {
      await rollupManager.connect(challenger).markDisputed(1);

      await expect(rollupManager.connect(challenger).confirmBatch(1))
        .to.emit(rollupManager, "BatchFinalized")
        .withArgs(1, stateRoot);

      const batch = await rollupManager.getBatch(1);
      expect(batch.status).to.equal(1); // BatchStatus.Finalized
    });

    it("should reject non-dispute manager calls", async function () {
      await expect(
        rollupManager.connect(other).markDisputed(1)
      ).to.be.revertedWith("RollupManager: not dispute manager");
    });
  });
});
