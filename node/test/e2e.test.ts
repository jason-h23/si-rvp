/**
 * SI-RVP - E2E Integration Tests
 *
 * Tests the complete dispute resolution flow:
 * - Happy path (no disputes)
 * - Dispute path (bisection + ZK proof)
 * - Timeout/fallback scenarios
 */

import { expect } from 'chai';
import * as path from 'path';
import { ethers, HDNodeWallet } from 'ethers';
import type { Context, Suite } from 'mocha';
import { MipsExecutor, MipsInstructionBuilder } from '../src/common/mips';
import { BisectionProtocol, ChannelManager } from '../src/common/bisection';
import { ZKProver, PoseidonHasher } from '../src/common/prover';
import { hashMipsStateKeccak } from '../src/common/hash';
import { MipsState, StateCommitment, BisectionMove } from '../src/common/types';
import { MetricsCollector } from '../src/metrics';

// Circuit paths
const CIRCUITS_DIR = path.join(__dirname, '..', '..', 'circuits', 'build');
const WASM_PATH = path.join(CIRCUITS_DIR, 'mips_single_step_js', 'mips_single_step.wasm');
const ZKEY_PATH = path.join(CIRCUITS_DIR, 'mips_single_step_final.zkey');
const VKEY_PATH = path.join(CIRCUITS_DIR, 'verification_key.json');

describe('SI-RVP E2E Tests', function (this: Suite) {
  // Increase timeout for E2E tests
  this.timeout(60000);

  let mipsExecutor: MipsExecutor;
  let bisectionProtocol: BisectionProtocol;
  let channelManager: ChannelManager;
  let metrics: MetricsCollector;
  let zkProver: ZKProver;
  let poseidonHasher: PoseidonHasher;

  // Test wallets
  let sequencerWallet: HDNodeWallet;
  let challengerWallet: HDNodeWallet;

  // Test program
  const testInstructions: bigint[] = [
    MipsInstructionBuilder.addi(1, 0, 100), // r1 = 100
    MipsInstructionBuilder.addi(2, 0, 50),  // r2 = 50
    MipsInstructionBuilder.add(3, 1, 2),    // r3 = r1 + r2 = 150
    MipsInstructionBuilder.sub(4, 1, 2),    // r4 = r1 - r2 = 50
    MipsInstructionBuilder.and(5, 1, 2),    // r5 = r1 & r2
    MipsInstructionBuilder.or(6, 1, 2),     // r6 = r1 | r2
    MipsInstructionBuilder.slt(7, 2, 1),    // r7 = (r2 < r1) = 1
    MipsInstructionBuilder.addi(8, 3, 10),  // r8 = r3 + 10 = 160
    MipsInstructionBuilder.addi(9, 4, 20),  // r9 = r4 + 20 = 70
    MipsInstructionBuilder.add(10, 8, 9),   // r10 = r8 + r9 = 230
  ];

  before(async function (this: Context) {
    zkProver = new ZKProver(WASM_PATH, ZKEY_PATH, VKEY_PATH);
    poseidonHasher = new PoseidonHasher();

    try {
      await zkProver.initialize();
      await poseidonHasher.initialize();
    } catch (e: any) {
      console.log('ZK components not available:', e.message);
      this.skip();
    }
  });

  beforeEach(() => {
    mipsExecutor = new MipsExecutor();
    bisectionProtocol = new BisectionProtocol();
    channelManager = new ChannelManager();
    metrics = new MetricsCollector();

    // Create test wallets
    sequencerWallet = ethers.Wallet.createRandom();
    challengerWallet = ethers.Wallet.createRandom();
  });

  // ============================================
  // Happy Path Tests
  // ============================================

  describe('Happy Path', () => {
    it('should execute MIPS program correctly', () => {
      let state = MipsExecutor.createInitialState();

      for (const instruction of testInstructions) {
        state = mipsExecutor.executeStep(state, instruction);
      }

      expect(state.step).to.equal(BigInt(testInstructions.length));
      expect(state.registers[1]).to.equal(100n);
      expect(state.registers[2]).to.equal(50n);
      expect(state.registers[3]).to.equal(150n); // 100 + 50
      expect(state.registers[4]).to.equal(50n);  // 100 - 50
      expect(state.registers[10]).to.equal(230n); // 160 + 70
    });

    it('should generate consistent state hashes', () => {
      let state = MipsExecutor.createInitialState();

      for (const instruction of testInstructions) {
        state = mipsExecutor.executeStep(state, instruction);
      }

      const hash1 = hashMipsStateKeccak(state);
      const hash2 = hashMipsStateKeccak(state);

      expect(hash1).to.equal(hash2);
      expect(hash1).to.match(/^0x[a-f0-9]{64}$/);
    });

    it('should verify matching states between sequencer and challenger', () => {
      // Sequencer executes
      let sequencerState = MipsExecutor.createInitialState();
      for (const instruction of testInstructions) {
        sequencerState = mipsExecutor.executeStep(sequencerState, instruction);
      }

      // Challenger executes (honest)
      let challengerState = MipsExecutor.createInitialState();
      for (const instruction of testInstructions) {
        challengerState = mipsExecutor.executeStep(challengerState, instruction);
      }

      const seqHash = hashMipsStateKeccak(sequencerState);
      const chalHash = hashMipsStateKeccak(challengerState);

      expect(seqHash).to.equal(chalHash);
    });
  });

  // ============================================
  // Dispute Path Tests
  // ============================================

  describe('Dispute Path', () => {
    it('should detect discrepancy between sequencer and challenger', () => {
      // Sequencer executes correctly
      let sequencerState = MipsExecutor.createInitialState();
      const sequencerHistory: Map<bigint, MipsState> = new Map();
      sequencerHistory.set(0n, { ...sequencerState, registers: [...sequencerState.registers] });

      for (const instruction of testInstructions) {
        sequencerState = mipsExecutor.executeStep(sequencerState, instruction);
        sequencerHistory.set(sequencerState.step, { ...sequencerState, registers: [...sequencerState.registers] });
      }

      // Challenger executes with intentional error at step 5
      let challengerState = MipsExecutor.createInitialState();
      const challengerHistory: Map<bigint, MipsState> = new Map();
      challengerHistory.set(0n, { ...challengerState, registers: [...challengerState.registers] });

      for (let i = 0; i < testInstructions.length; i++) {
        challengerState = mipsExecutor.executeStep(challengerState, testInstructions[i]);

        // Introduce error at step 5
        if (challengerState.step === 5n) {
          challengerState = { ...challengerState, registers: [...challengerState.registers] };
          challengerState.registers[5] = 999n;
        }

        challengerHistory.set(challengerState.step, { ...challengerState, registers: [...challengerState.registers] });
      }

      // Final states should differ
      const seqHash = hashMipsStateKeccak(sequencerState);
      const chalHash = hashMipsStateKeccak(challengerState);
      expect(seqHash).to.not.equal(chalHash);

      // States before step 5 should match
      const seq4 = sequencerHistory.get(4n)!;
      const chal4 = challengerHistory.get(4n)!;
      expect(hashMipsStateKeccak(seq4)).to.equal(hashMipsStateKeccak(chal4));

      // States at step 5 should differ
      const seq5 = sequencerHistory.get(5n)!;
      const chal5 = challengerHistory.get(5n)!;
      expect(hashMipsStateKeccak(seq5)).to.not.equal(hashMipsStateKeccak(chal5));
    });

    it('should narrow dispute to single step via bisection', () => {
      metrics.startTimer('bisection');

      // Setup state histories
      let sequencerState = MipsExecutor.createInitialState();
      const sequencerHistory: Map<bigint, MipsState> = new Map();
      sequencerHistory.set(0n, { ...sequencerState, registers: [...sequencerState.registers] });

      for (const instruction of testInstructions) {
        sequencerState = mipsExecutor.executeStep(sequencerState, instruction);
        sequencerHistory.set(sequencerState.step, { ...sequencerState, registers: [...sequencerState.registers] });
      }

      let challengerState = MipsExecutor.createInitialState();
      const challengerHistory: Map<bigint, MipsState> = new Map();
      challengerHistory.set(0n, { ...challengerState, registers: [...challengerState.registers] });

      const discrepancyStep = 5n;

      for (let i = 0; i < testInstructions.length; i++) {
        challengerState = mipsExecutor.executeStep(challengerState, testInstructions[i]);

        if (challengerState.step === discrepancyStep) {
          challengerState = { ...challengerState, registers: [...challengerState.registers] };
          challengerState.registers[5] = 999n;
        }

        challengerHistory.set(challengerState.step, { ...challengerState, registers: [...challengerState.registers] });
      }

      // Perform bisection
      let left = 0n;
      let right = BigInt(testInstructions.length);
      let rounds = 0;

      while (right - left > 1n) {
        const mid = left + (right - left) / 2n;

        const seqMid = sequencerHistory.get(mid)!;
        const chalMid = challengerHistory.get(mid)!;

        const match = hashMipsStateKeccak(seqMid) === hashMipsStateKeccak(chalMid);

        if (match) {
          left = mid;
        } else {
          right = mid;
        }

        rounds++;
      }

      const bisectionDuration = metrics.stopTimer('bisection');
      metrics.recordBisection(rounds, bisectionDuration);

      // Bisection should identify the step before discrepancy
      expect(left).to.equal(discrepancyStep - 1n);
      expect(rounds).to.be.lessThanOrEqual(Math.ceil(Math.log2(testInstructions.length)));
    });

    it('should create valid bisection moves with signatures', () => {
      const disputeId = 'test-dispute-001';
      const position = 5n;

      // Create test state
      let state = MipsExecutor.createInitialState();
      for (let i = 0; i < 5; i++) {
        state = mipsExecutor.executeStep(state, testInstructions[i]);
      }

      // Create commitment
      const commitment = bisectionProtocol.createCommitment(state, position);

      expect(commitment.stateHash).to.match(/^0x[a-f0-9]{64}$/);
      expect(commitment.step).to.equal(position);

      // Create attack move
      const attackMove = bisectionProtocol.createAttackMove(
        disputeId,
        0,
        position,
        commitment,
        challengerWallet
      );

      expect(attackMove.type).to.equal('attack');
      expect(attackMove.disputeId).to.equal(disputeId);
      expect(attackMove.depth).to.equal(0);
      expect(attackMove.position).to.equal(position);
      expect(attackMove.signature).to.match(/^0x[a-f0-9]+$/);

      // Create defend move
      const defendMove = bisectionProtocol.createDefendMove(
        disputeId,
        0,
        position,
        commitment,
        sequencerWallet
      );

      expect(defendMove.type).to.equal('defend');
    });
  });

  // ============================================
  // Channel Management Tests
  // ============================================

  describe('Channel Management', () => {
    it('should create and manage bisection channel', () => {
      const disputeId = 'test-dispute-001';
      const startStep = 0n;
      const endStep = 10n;

      const channel = channelManager.createChannel(
        disputeId,
        sequencerWallet.address,
        challengerWallet.address,
        startStep,
        endStep
      );

      expect(channel.channelId).to.equal(disputeId);
      expect(channel.sequencer).to.equal(sequencerWallet.address);
      expect(channel.challenger).to.equal(challengerWallet.address);
      expect(channel.startStep).to.equal(startStep);
      expect(channel.endStep).to.equal(endStep);
      expect(channel.status).to.equal('open');

      // Retrieve channel
      const retrieved = channelManager.getChannel(disputeId);
      expect(retrieved).to.not.be.undefined;
      expect(retrieved!.channelId).to.equal(disputeId);
    });

    it('should track moves in channel', () => {
      const disputeId = 'test-dispute-002';

      channelManager.createChannel(
        disputeId,
        sequencerWallet.address,
        challengerWallet.address,
        0n,
        10n
      );

      // Add moves
      const move1: BisectionMove = {
        disputeId,
        type: 'attack',
        depth: 0,
        position: 5n,
        claim: { stateHash: '0x' + '1'.repeat(64), step: 5n },
        signature: '0x' + 'a'.repeat(130),
        timestamp: Date.now(),
      };

      const move2: BisectionMove = {
        disputeId,
        type: 'defend',
        depth: 0,
        position: 5n,
        claim: { stateHash: '0x' + '2'.repeat(64), step: 5n },
        signature: '0x' + 'b'.repeat(130),
        timestamp: Date.now(),
      };

      channelManager.addMove(disputeId, move1);
      channelManager.addMove(disputeId, move2);

      const channel = channelManager.getChannel(disputeId)!;
      expect(channel.moves).to.have.lengthOf(2);
      expect(channel.moves[0].type).to.equal('attack');
      expect(channel.moves[1].type).to.equal('defend');
    });

    it('should update channel status', () => {
      const disputeId = 'test-dispute-003';

      channelManager.createChannel(
        disputeId,
        sequencerWallet.address,
        challengerWallet.address,
        0n,
        10n
      );

      channelManager.updateChannel(disputeId, { status: 'awaiting_proof' });

      const channel = channelManager.getChannel(disputeId)!;
      expect(channel.status).to.equal('awaiting_proof');
    });
  });

  // ============================================
  // Timeout/Fallback Tests
  // ============================================

  describe('Timeout/Fallback', () => {
    it('should detect timeout condition', () => {
      const disputeId = 'test-dispute-timeout';
      const timeoutDuration = 100; // 100ms for testing

      const channel = channelManager.createChannel(
        disputeId,
        sequencerWallet.address,
        challengerWallet.address,
        0n,
        10n
      );

      // Simulate time passing
      const originalLastActivity = channel.lastActivityAt;

      // Check if timeout (mock - in real scenario would check actual time)
      const isTimedOut = (Date.now() - originalLastActivity) > timeoutDuration;

      // Initially should not be timed out
      expect(isTimedOut).to.be.false;
    });

    it('should handle channel closure', () => {
      const disputeId = 'test-dispute-close';

      channelManager.createChannel(
        disputeId,
        sequencerWallet.address,
        challengerWallet.address,
        0n,
        10n
      );

      channelManager.updateChannel(disputeId, { status: 'closed' });

      const channel = channelManager.getChannel(disputeId)!;
      expect(channel.status).to.equal('closed');
    });
  });

  // ============================================
  // Full E2E Flow Test
  // ============================================

  describe('Full E2E Flow', () => {
    it('should complete entire dispute resolution flow', async () => {
      metrics.startTimer('totalDispute');

      // Step 1: Both parties execute program
      let sequencerState = MipsExecutor.createInitialState();
      const sequencerHistory: Map<bigint, MipsState> = new Map();
      const instructionHistory: Map<bigint, bigint> = new Map();
      sequencerHistory.set(0n, { ...sequencerState, registers: [...sequencerState.registers] });

      for (const instruction of testInstructions) {
        instructionHistory.set(sequencerState.step, instruction);
        sequencerState = mipsExecutor.executeStep(sequencerState, instruction);
        sequencerHistory.set(sequencerState.step, { ...sequencerState, registers: [...sequencerState.registers] });
      }

      let challengerState = MipsExecutor.createInitialState();
      const challengerHistory: Map<bigint, MipsState> = new Map();
      challengerHistory.set(0n, { ...challengerState, registers: [...challengerState.registers] });

      const discrepancyStep = 5n;

      for (let i = 0; i < testInstructions.length; i++) {
        challengerState = mipsExecutor.executeStep(challengerState, testInstructions[i]);

        if (challengerState.step === discrepancyStep) {
          challengerState = { ...challengerState, registers: [...challengerState.registers] };
          challengerState.registers[5] = 999n;
        }

        challengerHistory.set(challengerState.step, { ...challengerState, registers: [...challengerState.registers] });
      }

      // Step 2: Detect discrepancy
      const seqFinalHash = hashMipsStateKeccak(sequencerState);
      const chalFinalHash = hashMipsStateKeccak(challengerState);
      expect(seqFinalHash).to.not.equal(chalFinalHash);

      // Step 3: Create channel
      const disputeId = 'e2e-dispute-001';
      const channel = channelManager.createChannel(
        disputeId,
        sequencerWallet.address,
        challengerWallet.address,
        0n,
        BigInt(testInstructions.length)
      );

      metrics.recordMessage('channelOpen', 200);

      // Step 4: Perform bisection
      metrics.startTimer('bisection');
      let left = 0n;
      let right = BigInt(testInstructions.length);
      let rounds = 0;

      while (right - left > 1n) {
        const mid = left + (right - left) / 2n;

        const seqMid = sequencerHistory.get(mid)!;
        const chalMid = challengerHistory.get(mid)!;

        // Create and exchange moves
        const attackMove = bisectionProtocol.createAttackMove(
          disputeId,
          rounds,
          mid,
          bisectionProtocol.createCommitment(chalMid, mid),
          challengerWallet
        );
        channelManager.addMove(disputeId, attackMove);
        metrics.recordMessage('bisectionMove', JSON.stringify(attackMove, (_, v) => typeof v === 'bigint' ? v.toString() : v).length);

        const defendMove = bisectionProtocol.createDefendMove(
          disputeId,
          rounds,
          mid,
          bisectionProtocol.createCommitment(seqMid, mid),
          sequencerWallet
        );
        channelManager.addMove(disputeId, defendMove);
        metrics.recordMessage('bisectionMove', JSON.stringify(defendMove, (_, v) => typeof v === 'bigint' ? v.toString() : v).length);

        const match = hashMipsStateKeccak(seqMid) === hashMipsStateKeccak(chalMid);

        if (match) {
          left = mid;
        } else {
          right = mid;
        }

        rounds++;
      }

      const bisectionDuration = metrics.stopTimer('bisection');
      metrics.recordBisection(rounds, bisectionDuration);

      // Step 5: Identify disputed step
      const disputedStep = left;
      expect(disputedStep).to.equal(discrepancyStep - 1n);

      // Step 6: Generate real ZK proof
      metrics.recordMessage('proofRequest', 100);

      const preState = sequencerHistory.get(disputedStep)!;
      const postState = sequencerHistory.get(disputedStep + 1n)!;
      const instruction = instructionHistory.get(disputedStep)!;

      const preHash = poseidonHasher.hashMipsState(preState);
      const postHash = poseidonHasher.hashMipsState(postState);

      const proofInput = ZKProver.createProofInput(preState, postState, preHash, postHash, instruction);

      metrics.startTimer('proofGeneration');
      const proof = await zkProver.generateProof(proofInput);
      const proofGenDuration = metrics.stopTimer('proofGeneration');
      metrics.recordProofGeneration(proofGenDuration);

      expect(proof).to.have.property('proof');
      expect(proof).to.have.property('publicInputs');
      metrics.recordMessage('proofSubmit', 500);

      // Step 7: Verify real ZK proof
      metrics.startTimer('verification');
      const isValid = await zkProver.verifyProof(proof);
      const verifyDuration = metrics.stopTimer('verification');
      metrics.recordOnChainVerification(verifyDuration);

      expect(isValid).to.be.true;

      // Step 8: Close channel
      channelManager.updateChannel(disputeId, { status: 'closed' });

      const totalDuration = metrics.stopTimer('totalDispute');
      metrics.recordTotalDisputeResolution(totalDuration);

      // Assertions
      const finalChannel = channelManager.getChannel(disputeId)!;
      expect(finalChannel.status).to.equal('closed');
      expect(finalChannel.moves.length).to.be.greaterThan(0);

      // Log metrics
      console.log('\n' + metrics.generateReport());
    });
  });
});
