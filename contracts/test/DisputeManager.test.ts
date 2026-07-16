/**
 * DisputeManager Contract Tests
 *
 * Unit tests for the DisputeManager smart contract which handles the dispute
 * resolution process in the SI-RVP hybrid rollup protocol.
 *
 * Test Coverage:
 * - Dispute initiation and bond deposits
 * - Off-chain bisection result submission
 * - ZK proof verification integration
 * - Dispute resolution (challenger/sequencer wins)
 * - Timeout handling and fund distribution
 *
 * The DisputeManager coordinates with RollupManager and ZKVerifier to
 * enable efficient dispute resolution with O(1) on-chain transactions.
 *
 * @module test/DisputeManager.test.ts
 * @see contracts/src/DisputeManager.sol
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { DisputeManager, RollupManager, ZKVerifier } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("DisputeManager", function () {
  let disputeManager: DisputeManager;
  let rollupManager: RollupManager;
  let zkVerifier: ZKVerifier;
  let sequencer: HardhatEthersSigner;
  let challenger: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  const BOND_AMOUNT = ethers.parseEther("0.01");
  const PROOF_DEADLINE = 60 * 60; // 1 hour
  const BISECTION_DEADLINE = 30 * 60; // 30 minutes

  const stateRoot1 = ethers.keccak256(ethers.toUtf8Bytes("state1"));
  const stateRoot2 = ethers.keccak256(ethers.toUtf8Bytes("state2"));

  beforeEach(async function () {
    [sequencer, challenger, other] = await ethers.getSigners();

    // Deploy ZKVerifier
    const ZKVerifier = await ethers.getContractFactory("ZKVerifier");
    zkVerifier = await ZKVerifier.deploy();
    await zkVerifier.waitForDeployment();

    // Deploy RollupManager
    const RollupManager = await ethers.getContractFactory("RollupManager");
    rollupManager = await RollupManager.deploy(sequencer.address);
    await rollupManager.waitForDeployment();

    // Deploy DisputeManager
    const DisputeManager = await ethers.getContractFactory("DisputeManager");
    disputeManager = await DisputeManager.deploy(
      await zkVerifier.getAddress(),
      await rollupManager.getAddress()
    );
    await disputeManager.waitForDeployment();

    // Connect DisputeManager to RollupManager
    await rollupManager.setDisputeManager(await disputeManager.getAddress());

    // Sequencer proposes a state root
    await rollupManager.connect(sequencer).proposeStateRoot(stateRoot1, 1);
  });

  describe("Deployment", function () {
    it("should set correct ZKVerifier", async function () {
      expect(await disputeManager.zkVerifier()).to.equal(
        await zkVerifier.getAddress()
      );
    });

    it("should set correct RollupManager", async function () {
      expect(await disputeManager.rollupManager()).to.equal(
        await rollupManager.getAddress()
      );
    });

    it("should start with nextDisputeId = 1", async function () {
      expect(await disputeManager.nextDisputeId()).to.equal(1);
    });
  });

  describe("initiateDispute", function () {
    it("should create dispute with valid bond", async function () {
      await expect(
        disputeManager
          .connect(challenger)
          .initiateDispute(1, stateRoot2, { value: BOND_AMOUNT })
      )
        .to.emit(disputeManager, "DisputeInitiated")
        .withArgs(1, 1, challenger.address, stateRoot2);

      expect(await disputeManager.nextDisputeId()).to.equal(2);
    });

    it("should store dispute correctly", async function () {
      await disputeManager
        .connect(challenger)
        .initiateDispute(1, stateRoot2, { value: BOND_AMOUNT });

      const dispute = await disputeManager.getDispute(1);
      expect(dispute.batchIndex).to.equal(1);
      expect(dispute.challenger).to.equal(challenger.address);
      expect(dispute.sequencer).to.equal(sequencer.address);
      expect(dispute.challengerClaim).to.equal(stateRoot2);
      expect(dispute.sequencerClaim).to.equal(stateRoot1);
      expect(dispute.challengerBond).to.equal(BOND_AMOUNT);
      expect(dispute.status).to.equal(1); // DisputeStatus.Initiated
    });

    it("should update batch status to Disputed", async function () {
      await disputeManager
        .connect(challenger)
        .initiateDispute(1, stateRoot2, { value: BOND_AMOUNT });

      const batch = await rollupManager.getBatch(1);
      expect(batch.status).to.equal(2); // BatchStatus.Disputed
    });

    it("should reject insufficient bond", async function () {
      await expect(
        disputeManager
          .connect(challenger)
          .initiateDispute(1, stateRoot2, { value: BOND_AMOUNT - 1n })
      ).to.be.revertedWith("DisputeManager: insufficient bond");
    });

    it("should reject same state root", async function () {
      await expect(
        disputeManager
          .connect(challenger)
          .initiateDispute(1, stateRoot1, { value: BOND_AMOUNT })
      ).to.be.revertedWith("DisputeManager: same state root");
    });

    it("should reject duplicate dispute", async function () {
      await disputeManager
        .connect(challenger)
        .initiateDispute(1, stateRoot2, { value: BOND_AMOUNT });

      await expect(
        disputeManager
          .connect(other)
          .initiateDispute(1, stateRoot2, { value: BOND_AMOUNT })
      ).to.be.revertedWith("DisputeManager: dispute exists");
    });
  });

  describe("depositSequencerBond", function () {
    beforeEach(async function () {
      await disputeManager
        .connect(challenger)
        .initiateDispute(1, stateRoot2, { value: BOND_AMOUNT });
    });

    it("should allow sequencer to deposit bond", async function () {
      await disputeManager
        .connect(sequencer)
        .depositSequencerBond(1, { value: BOND_AMOUNT });

      const dispute = await disputeManager.getDispute(1);
      expect(dispute.sequencerBond).to.equal(BOND_AMOUNT);
    });

    it("should reject non-sequencer", async function () {
      await expect(
        disputeManager
          .connect(challenger)
          .depositSequencerBond(1, { value: BOND_AMOUNT })
      ).to.be.revertedWith("DisputeManager: not sequencer");
    });

    it("should reject double deposit", async function () {
      await disputeManager
        .connect(sequencer)
        .depositSequencerBond(1, { value: BOND_AMOUNT });

      await expect(
        disputeManager
          .connect(sequencer)
          .depositSequencerBond(1, { value: BOND_AMOUNT })
      ).to.be.revertedWith("DisputeManager: already deposited");
    });
  });

  describe("submitBisectionResult", function () {
    const bisectionCommitment = ethers.keccak256(
      ethers.toUtf8Bytes("bisection")
    );
    const disputedStep = 100;

    beforeEach(async function () {
      await disputeManager
        .connect(challenger)
        .initiateDispute(1, stateRoot2, { value: BOND_AMOUNT });
    });

    it("should accept valid bisection result with both signatures", async function () {
      const messageHash = ethers.keccak256(
        ethers.solidityPacked(
          ["uint256", "bytes32", "uint256"],
          [1, bisectionCommitment, disputedStep]
        )
      );

      const challengerSig = await challenger.signMessage(
        ethers.getBytes(messageHash)
      );
      const sequencerSig = await sequencer.signMessage(
        ethers.getBytes(messageHash)
      );

      await expect(
        disputeManager.submitBisectionResult(
          1,
          bisectionCommitment,
          disputedStep,
          challengerSig,
          sequencerSig
        )
      )
        .to.emit(disputeManager, "BisectionCompleted")
        .withArgs(1, bisectionCommitment, disputedStep);
    });

    it("should reject after bisection deadline", async function () {
      const messageHash = ethers.keccak256(
        ethers.solidityPacked(
          ["uint256", "bytes32", "uint256"],
          [1, bisectionCommitment, disputedStep]
        )
      );

      const challengerSig = await challenger.signMessage(
        ethers.getBytes(messageHash)
      );
      const sequencerSig = await sequencer.signMessage(
        ethers.getBytes(messageHash)
      );

      await time.increase(BISECTION_DEADLINE + 1);

      await expect(
        disputeManager.submitBisectionResult(
          1,
          bisectionCommitment,
          disputedStep,
          challengerSig,
          sequencerSig
        )
      ).to.be.revertedWith("DisputeManager: bisection timeout");
    });

    it("should reject invalid challenger signature", async function () {
      const messageHash = ethers.keccak256(
        ethers.solidityPacked(
          ["uint256", "bytes32", "uint256"],
          [1, bisectionCommitment, disputedStep]
        )
      );

      const wrongSig = await other.signMessage(ethers.getBytes(messageHash));
      const sequencerSig = await sequencer.signMessage(
        ethers.getBytes(messageHash)
      );

      await expect(
        disputeManager.submitBisectionResult(
          1,
          bisectionCommitment,
          disputedStep,
          wrongSig,
          sequencerSig
        )
      ).to.be.revertedWith("DisputeManager: invalid challenger sig");
    });
  });

  describe("triggerTimeout", function () {
    beforeEach(async function () {
      await disputeManager
        .connect(challenger)
        .initiateDispute(1, stateRoot2, { value: BOND_AMOUNT });
    });

    it("should allow timeout after deadline", async function () {
      await time.increase(PROOF_DEADLINE + 1);

      const challengerBalanceBefore = await ethers.provider.getBalance(
        challenger.address
      );

      await expect(disputeManager.triggerTimeout(1))
        .to.emit(disputeManager, "DisputeTimeout")
        .withArgs(1);

      // Challenger should receive their bond back
      const challengerBalanceAfter = await ethers.provider.getBalance(
        challenger.address
      );
      expect(challengerBalanceAfter).to.be.gt(challengerBalanceBefore);

      // Batch should be rejected
      const batch = await rollupManager.getBatch(1);
      expect(batch.status).to.equal(3); // BatchStatus.Rejected
    });

    it("should reject before deadline", async function () {
      await expect(disputeManager.triggerTimeout(1)).to.be.revertedWith(
        "DisputeManager: deadline not passed"
      );
    });
  });

  describe("requiredBond", function () {
    it("should return correct bond amount", async function () {
      expect(await disputeManager.requiredBond()).to.equal(BOND_AMOUNT);
    });
  });

  describe("New Dispute Fields (Phase 7)", function () {
    it("should set resolvedAt to 0 on creation", async function () {
      await disputeManager
        .connect(challenger)
        .initiateDispute(1, stateRoot2, { value: BOND_AMOUNT });

      const dispute = await disputeManager.getDispute(1);
      expect(dispute.resolvedAt).to.equal(0);
    });

    it("should set l1Head on creation", async function () {
      await disputeManager
        .connect(challenger)
        .initiateDispute(1, stateRoot2, { value: BOND_AMOUNT });

      const dispute = await disputeManager.getDispute(1);
      // l1Head should be a non-zero blockhash (previous block)
      expect(dispute.l1Head).to.not.equal(ethers.ZeroHash);
    });
  });

  describe("Security Fixes (Devil Review)", function () {
    const disputedStep = 42;

    // Public inputs used in proof submission — bisectionCommitment is derived from these.
    // snarkjs public-signal order: [0]=valid (circuit output), [1]=preStateHash, [2]=postStateHash.
    // This ensures the on-chain binding check passes: keccak256(inputs[1], inputs[2], step)
    const validPublicInputs = [1n, 2n, 3n];

    // Compute bisectionCommitment to match the binding formula in submitProof:
    // keccak256(abi.encodePacked(publicInputs[1], publicInputs[2], disputedSteps[disputeId]))
    const bisectionCommitment = ethers.keccak256(
      ethers.solidityPacked(
        ["uint256", "uint256", "uint256"],
        [validPublicInputs[1], validPublicInputs[2], disputedStep]
      )
    );

    // Helper: create a dispute and return the dispute ID
    async function createDispute(): Promise<bigint> {
      await disputeManager
        .connect(challenger)
        .initiateDispute(1, stateRoot2, { value: BOND_AMOUNT });
      return 1n;
    }

    // Helper: submit valid bisection result for a dispute
    async function submitBisection(disputeId: bigint): Promise<void> {
      const messageHash = ethers.keccak256(
        ethers.solidityPacked(
          ["uint256", "bytes32", "uint256"],
          [disputeId, bisectionCommitment, disputedStep]
        )
      );
      const challengerSig = await challenger.signMessage(
        ethers.getBytes(messageHash)
      );
      const sequencerSig = await sequencer.signMessage(
        ethers.getBytes(messageHash)
      );
      await disputeManager.submitBisectionResult(
        disputeId,
        bisectionCommitment,
        disputedStep,
        challengerSig,
        sequencerSig
      );
    }

    // Issue 1: submitProof access control
    describe("submitProof access control", function () {
      const dummyProof: [
        bigint, bigint, bigint, bigint,
        bigint, bigint, bigint, bigint
      ] = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n];

      beforeEach(async function () {
        const disputeId = await createDispute();
        await submitBisection(disputeId);
      });

      it("should reject submitProof from non-participant", async function () {
        await expect(
          disputeManager
            .connect(other)
            .submitProof(1, dummyProof, validPublicInputs)
        ).to.be.revertedWith("DisputeManager: not dispute participant");
      });

      it("should reject submitProof with wrong publicInputs length (0 inputs)", async function () {
        await expect(
          disputeManager
            .connect(sequencer)
            .submitProof(1, dummyProof, [])
        ).to.be.revertedWith("DisputeManager: invalid public inputs length");
      });

      it("should reject submitProof with wrong publicInputs length (2 inputs)", async function () {
        await expect(
          disputeManager
            .connect(sequencer)
            .submitProof(1, dummyProof, [1n, 2n])
        ).to.be.revertedWith("DisputeManager: invalid public inputs length");
      });

      it("should reject submitProof with wrong publicInputs length (4 inputs)", async function () {
        await expect(
          disputeManager
            .connect(sequencer)
            .submitProof(1, dummyProof, [1n, 2n, 3n, 4n])
        ).to.be.revertedWith("DisputeManager: invalid public inputs length");
      });

      it("should allow sequencer to pass access control (access check succeeds, ZK may reject)", async function () {
        // The access control and binding checks pass for sequencer with correct inputs.
        // bisectionCommitment was computed from validPublicInputs so the binding check passes.
        // The ZKVerifier may reject the dummy proof, but the revert reason must NOT be any
        // of the access-control or binding errors.
        let reverted = false;
        let revertReason = "";
        try {
          await disputeManager
            .connect(sequencer)
            .submitProof(1, dummyProof, validPublicInputs);
        } catch (err: unknown) {
          reverted = true;
          revertReason = (err as Error).message;
        }

        if (reverted) {
          // If it reverted, it must NOT be the access control, public inputs, or binding error
          expect(revertReason).to.not.include("not dispute participant");
          expect(revertReason).to.not.include("invalid public inputs length");
          expect(revertReason).to.not.include("proof does not match bisection");
        }
        // If it didn't revert, status should be ProofSubmitted
        if (!reverted) {
          const dispute = await disputeManager.getDispute(1);
          expect(dispute.status).to.equal(2); // DisputeStatus.ProofSubmitted
        }
      });

      it("should allow challenger to pass access control (access check succeeds, ZK may reject)", async function () {
        let reverted = false;
        let revertReason = "";
        try {
          await disputeManager
            .connect(challenger)
            .submitProof(1, dummyProof, validPublicInputs);
        } catch (err: unknown) {
          reverted = true;
          revertReason = (err as Error).message;
        }

        if (reverted) {
          expect(revertReason).to.not.include("not dispute participant");
          expect(revertReason).to.not.include("invalid public inputs length");
          expect(revertReason).to.not.include("proof does not match bisection");
        }
        if (!reverted) {
          const dispute = await disputeManager.getDispute(1);
          expect(dispute.status).to.equal(2); // DisputeStatus.ProofSubmitted
        }
      });
    });

    // Issue 2: submitBisectionResult idempotency
    describe("submitBisectionResult idempotency", function () {
      it("should reject second bisection submission (bisection already submitted)", async function () {
        const disputeId = await createDispute();

        // First submission — must succeed
        await submitBisection(disputeId);

        // Verify commitment was stored
        const disputeAfterFirst = await disputeManager.getDispute(disputeId);
        expect(disputeAfterFirst.bisectionCommitment).to.equal(bisectionCommitment);

        // Second submission with the same data must be rejected
        const messageHash = ethers.keccak256(
          ethers.solidityPacked(
            ["uint256", "bytes32", "uint256"],
            [disputeId, bisectionCommitment, disputedStep]
          )
        );
        const challengerSig = await challenger.signMessage(
          ethers.getBytes(messageHash)
        );
        const sequencerSig = await sequencer.signMessage(
          ethers.getBytes(messageHash)
        );

        await expect(
          disputeManager.submitBisectionResult(
            disputeId,
            bisectionCommitment,
            disputedStep,
            challengerSig,
            sequencerSig
          )
        ).to.be.revertedWith("DisputeManager: bisection already submitted");
      });

      it("should reject second bisection submission with different commitment", async function () {
        const disputeId = await createDispute();

        // First submission — must succeed
        await submitBisection(disputeId);

        // Second attempt with a different commitment
        const altCommitment = ethers.keccak256(
          ethers.toUtf8Bytes("alternative-bisection")
        );
        const altStep = 99;
        const messageHash = ethers.keccak256(
          ethers.solidityPacked(
            ["uint256", "bytes32", "uint256"],
            [disputeId, altCommitment, altStep]
          )
        );
        const challengerSig = await challenger.signMessage(
          ethers.getBytes(messageHash)
        );
        const sequencerSig = await sequencer.signMessage(
          ethers.getBytes(messageHash)
        );

        await expect(
          disputeManager.submitBisectionResult(
            disputeId,
            altCommitment,
            altStep,
            challengerSig,
            sequencerSig
          )
        ).to.be.revertedWith("DisputeManager: bisection already submitted");
      });
    });

    // Task B: Full flow — create dispute, submit bisection, submit proof → ProofSubmitted
    describe("submitProof full flow (happy path to ProofSubmitted)", function () {
      const dummyProof: [
        bigint, bigint, bigint, bigint,
        bigint, bigint, bigint, bigint
      ] = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n];
      // validPublicInputs and bisectionCommitment are inherited from the outer describe scope.
      // bisectionCommitment = keccak256(solidityPacked([inputs[0], inputs[1], disputedStep]))

      it("should transition dispute to ProofSubmitted after sequencer submits proof", async function () {
        // Step 1: Create dispute
        const disputeId = await createDispute();

        // Verify status is Initiated
        let dispute = await disputeManager.getDispute(disputeId);
        expect(dispute.status).to.equal(1); // DisputeStatus.Initiated

        // Step 2: Submit bisection result
        await submitBisection(disputeId);
        dispute = await disputeManager.getDispute(disputeId);
        expect(dispute.bisectionCommitment).to.equal(bisectionCommitment);

        // Step 3: Submit proof — dummy values, ZKVerifier returns false but status advances
        // The contract sets status = ProofSubmitted regardless of whether proof is valid.
        await expect(
          disputeManager
            .connect(sequencer)
            .submitProof(disputeId, dummyProof, validPublicInputs)
        )
          .to.emit(disputeManager, "ProofSubmitted")
          .withArgs(disputeId, sequencer.address, false); // false because dummy proof is invalid

        // Step 4: Verify status is ProofSubmitted
        dispute = await disputeManager.getDispute(disputeId);
        expect(dispute.status).to.equal(2); // DisputeStatus.ProofSubmitted
      });

      it("should transition dispute to ProofSubmitted after challenger submits proof", async function () {
        // Step 1: Create dispute
        const disputeId = await createDispute();

        // Step 2: Submit bisection result
        await submitBisection(disputeId);

        // Step 3: Challenger submits proof
        await expect(
          disputeManager
            .connect(challenger)
            .submitProof(disputeId, dummyProof, validPublicInputs)
        )
          .to.emit(disputeManager, "ProofSubmitted")
          .withArgs(disputeId, challenger.address, false);

        // Step 4: Verify status is ProofSubmitted
        const dispute = await disputeManager.getDispute(disputeId);
        expect(dispute.status).to.equal(2); // DisputeStatus.ProofSubmitted
      });

      it("should require bisection to be completed before submitProof", async function () {
        // Create dispute but do NOT submit bisection
        const disputeId = await createDispute();

        await expect(
          disputeManager
            .connect(sequencer)
            .submitProof(disputeId, dummyProof, validPublicInputs)
        ).to.be.revertedWith("DisputeManager: bisection not completed");
      });

      it("should record proofValid=false for dummy proof in proofResults", async function () {
        const disputeId = await createDispute();
        await submitBisection(disputeId);
        await disputeManager
          .connect(sequencer)
          .submitProof(disputeId, dummyProof, validPublicInputs);

        expect(await disputeManager.proofResults(disputeId)).to.equal(false);
      });
    });
  });

  describe("Proxy Authorization (Phase 7)", function () {
    it("should set owner to deployer", async function () {
      expect(await disputeManager.owner()).to.equal(sequencer.address);
    });

    it("should allow owner to add authorized proxy", async function () {
      await expect(
        disputeManager.connect(sequencer).addAuthorizedProxy(other.address)
      )
        .to.emit(disputeManager, "AuthorizedProxyAdded")
        .withArgs(other.address);

      expect(await disputeManager.authorizedProxies(other.address)).to.equal(true);
    });

    it("should reject non-owner from adding proxy", async function () {
      await expect(
        disputeManager.connect(challenger).addAuthorizedProxy(other.address)
      ).to.be.revertedWith("DisputeManager: not owner");
    });

    it("should allow owner to remove authorized proxy", async function () {
      await disputeManager.connect(sequencer).addAuthorizedProxy(other.address);

      await expect(
        disputeManager.connect(sequencer).removeAuthorizedProxy(other.address)
      )
        .to.emit(disputeManager, "AuthorizedProxyRemoved")
        .withArgs(other.address);

      expect(await disputeManager.authorizedProxies(other.address)).to.equal(false);
    });

    it("should reject adding zero address as proxy", async function () {
      await expect(
        disputeManager.connect(sequencer).addAuthorizedProxy(ethers.ZeroAddress)
      ).to.be.revertedWith("DisputeManager: zero address");
    });

    describe("initiateDisputeFor", function () {
      beforeEach(async function () {
        // Authorize 'other' as a proxy
        await disputeManager.connect(sequencer).addAuthorizedProxy(other.address);
      });

      it("should allow authorized proxy to initiate dispute on behalf of challenger", async function () {
        await expect(
          disputeManager
            .connect(other)
            .initiateDisputeFor(challenger.address, 1, stateRoot2, { value: BOND_AMOUNT })
        )
          .to.emit(disputeManager, "DisputeInitiated")
          .withArgs(1, 1, challenger.address, stateRoot2);

        const dispute = await disputeManager.getDispute(1);
        expect(dispute.challenger).to.equal(challenger.address);
      });

      it("should reject non-authorized caller", async function () {
        await expect(
          disputeManager
            .connect(challenger)
            .initiateDisputeFor(challenger.address, 1, stateRoot2, { value: BOND_AMOUNT })
        ).to.be.revertedWith("DisputeManager: not authorized proxy");
      });

      it("should reject zero address as onBehalfOf", async function () {
        await expect(
          disputeManager
            .connect(other)
            .initiateDisputeFor(ethers.ZeroAddress, 1, stateRoot2, { value: BOND_AMOUNT })
        ).to.be.revertedWith("DisputeManager: zero address");
      });
    });
  });
});
