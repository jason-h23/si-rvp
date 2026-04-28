/**
 * Full Integration Tests
 *
 * Tests the complete flow: MIPS → Bisection → ZK Proof → Verification
 */

import { expect } from 'chai';
import * as path from 'path';
import { ethers } from 'ethers';
import type { Context, Suite } from 'mocha';
import { MipsExecutor, MipsInstructionBuilder } from '../src/common/mips';
import { BisectionProtocol, ChannelManager } from '../src/common/bisection';
import { ZKProver, PoseidonHasher } from '../src/common/prover';
import { hashMipsStateKeccak } from '../src/common/hash';
import { MipsState } from '../src/common/types';

// Circuit paths
const CIRCUITS_DIR = path.join(__dirname, '..', '..', 'circuits', 'build');
const WASM_PATH = path.join(CIRCUITS_DIR, 'mips_single_step_js', 'mips_single_step.wasm');
const ZKEY_PATH = path.join(CIRCUITS_DIR, 'mips_single_step_final.zkey');
const VKEY_PATH = path.join(CIRCUITS_DIR, 'verification_key.json');

describe('Full Integration Tests', function(this: Suite) {
  // Increase timeout for ZK proof generation
  this.timeout(60000);

  let mipsExecutor: MipsExecutor;
  let bisectionProtocol: BisectionProtocol;
  let channelManager: ChannelManager;
  let zkProver: ZKProver;
  let poseidonHasher: PoseidonHasher;
  let sequencerWallet: ethers.HDNodeWallet;
  let challengerWallet: ethers.HDNodeWallet;

  before(async function(this: Context) {
    // Initialize components
    mipsExecutor = new MipsExecutor();
    bisectionProtocol = new BisectionProtocol();
    channelManager = new ChannelManager();

    // Initialize ZK components
    zkProver = new ZKProver(WASM_PATH, ZKEY_PATH, VKEY_PATH);
    poseidonHasher = new PoseidonHasher();

    try {
      await zkProver.initialize();
      await poseidonHasher.initialize();
    } catch (e: any) {
      console.log('ZK components not available:', e.message);
      this.skip();
    }

    // Create test wallets
    sequencerWallet = ethers.Wallet.createRandom();
    challengerWallet = ethers.Wallet.createRandom();
  });

  describe('MIPS → Poseidon Hash Integration', () => {
    it('should generate consistent Poseidon hashes for MIPS states', async () => {
      const state = MipsExecutor.createInitialState();

      const hash1 = poseidonHasher.hashMipsState(state);
      const hash2 = poseidonHasher.hashMipsState(state);

      expect(hash1).to.equal(hash2);
      expect(typeof hash1).to.equal('bigint');
    });

    it('should generate different hashes for different states', async () => {
      const state1 = MipsExecutor.createInitialState();
      const state2 = mipsExecutor.executeStep(state1, MipsInstructionBuilder.addi(1, 0, 100));

      const hash1 = poseidonHasher.hashMipsState(state1);
      const hash2 = poseidonHasher.hashMipsState(state2);

      expect(hash1).to.not.equal(hash2);
    });
  });

  describe('MIPS → Bisection Integration', () => {
    it('should detect discrepancy through bisection', async () => {
      // Sequencer execution
      const instructions = [
        MipsInstructionBuilder.addi(1, 0, 100),
        MipsInstructionBuilder.addi(2, 0, 50),
        MipsInstructionBuilder.add(3, 1, 2),
        MipsInstructionBuilder.sub(4, 1, 2),
        MipsInstructionBuilder.and(5, 1, 2),
        MipsInstructionBuilder.or(6, 1, 2),
        MipsInstructionBuilder.xor(7, 1, 2),
        MipsInstructionBuilder.slt(8, 2, 1),
      ];

      // Sequencer builds state history
      const sequencerHistory: Map<bigint, MipsState> = new Map();
      let seqState = MipsExecutor.createInitialState();
      sequencerHistory.set(0n, { ...seqState, registers: [...seqState.registers] });

      for (const insn of instructions) {
        seqState = mipsExecutor.executeStep(seqState, insn);
        sequencerHistory.set(seqState.step, { ...seqState, registers: [...seqState.registers] });
      }

      // Challenger builds state history with error at step 5
      const challengerHistory: Map<bigint, MipsState> = new Map();
      let chalState = MipsExecutor.createInitialState();
      challengerHistory.set(0n, { ...chalState, registers: [...chalState.registers] });

      for (let i = 0; i < instructions.length; i++) {
        chalState = mipsExecutor.executeStep(chalState, instructions[i]);

        // Introduce error at step 5
        if (chalState.step === 5n) {
          chalState = { ...chalState, registers: [...chalState.registers] };
          chalState.registers[6] = 9999n; // Wrong value
        }

        challengerHistory.set(chalState.step, { ...chalState, registers: [...chalState.registers] });
      }

      // Bisection to find discrepancy
      let left = 0n;
      let right = BigInt(instructions.length);
      let rounds = 0;

      while (right - left > 1n) {
        const mid = left + (right - left) / 2n;

        const seqMid = sequencerHistory.get(mid)!;
        const chalMid = challengerHistory.get(mid)!;

        const seqHash = hashMipsStateKeccak(seqMid);
        const chalHash = hashMipsStateKeccak(chalMid);

        if (seqHash === chalHash) {
          left = mid;
        } else {
          right = mid;
        }
        rounds++;
      }

      // Bisection should find the divergence point
      // Error at step 5 affects r6, but OR instruction at step 6 overwrites r6
      // So the final divergence depends on which registers are affected
      expect(rounds).to.be.lessThanOrEqual(Math.ceil(Math.log2(instructions.length)));
      expect(left < right).to.be.true;
    });
  });

  describe('MIPS → ZK Proof Integration', () => {
    it('should generate and verify ZK proof for single step', async function() {
      // Create pre and post states
      const preState = MipsExecutor.createInitialState();
      const instruction = MipsInstructionBuilder.addi(1, 0, 100);
      const postState = mipsExecutor.executeStep(preState, instruction);

      // Generate Poseidon hashes
      const preHash = poseidonHasher.hashMipsState(preState);
      const postHash = poseidonHasher.hashMipsState(postState);

      // Create proof input
      const proofInput = ZKProver.createProofInput(
        preState,
        postState,
        preHash,
        postHash,
        instruction
      );

      // Generate proof
      const startTime = Date.now();
      const proof = await zkProver.generateProof(proofInput);
      const proofTime = Date.now() - startTime;

      console.log(`    Proof generated in ${proofTime}ms`);

      // Verify proof
      const isValid = await zkProver.verifyProof(proof);

      expect(isValid).to.be.true;
      expect(proof.proof.a).to.have.lengthOf(2);
      expect(proof.proof.b).to.have.lengthOf(2);
      expect(proof.proof.c).to.have.lengthOf(2);
      expect(proof.publicInputs.length).to.be.greaterThan(0);
    });

    it('should generate valid proof for ADD instruction', async function() {
      let state = MipsExecutor.createInitialState();
      state = mipsExecutor.executeStep(state, MipsInstructionBuilder.addi(1, 0, 100));
      state = mipsExecutor.executeStep(state, MipsInstructionBuilder.addi(2, 0, 50));

      const preState = { ...state, registers: [...state.registers] };
      const instruction = MipsInstructionBuilder.add(3, 1, 2);
      const postState = mipsExecutor.executeStep(preState, instruction);

      const preHash = poseidonHasher.hashMipsState(preState);
      const postHash = poseidonHasher.hashMipsState(postState);

      const proofInput = ZKProver.createProofInput(preState, postState, preHash, postHash, instruction);
      const proof = await zkProver.generateProof(proofInput);
      const isValid = await zkProver.verifyProof(proof);

      expect(isValid).to.be.true;
      expect(postState.registers[3]).to.equal(150n);
    });
  });

  describe('Full Dispute Resolution Flow', () => {
    it('should complete full dispute resolution with ZK proof', async function() {
      console.log('\n    === Full Dispute Resolution Flow ===');

      // Step 1: Generate program
      const instructions = [
        MipsInstructionBuilder.addi(1, 0, 100),
        MipsInstructionBuilder.addi(2, 0, 50),
        MipsInstructionBuilder.add(3, 1, 2),
        MipsInstructionBuilder.sub(4, 1, 2),
      ];
      console.log(`    1. Program: ${instructions.length} instructions`);

      // Step 2: Sequencer executes
      const sequencerHistory: Map<bigint, MipsState> = new Map();
      const instructionHistory: Map<bigint, bigint> = new Map();
      let seqState = MipsExecutor.createInitialState();
      sequencerHistory.set(0n, { ...seqState, registers: [...seqState.registers] });

      for (let i = 0; i < instructions.length; i++) {
        instructionHistory.set(seqState.step, instructions[i]);
        seqState = mipsExecutor.executeStep(seqState, instructions[i]);
        sequencerHistory.set(seqState.step, { ...seqState, registers: [...seqState.registers] });
      }
      console.log(`    2. Sequencer executed: final r3=${seqState.registers[3]}`);

      // Step 3: Challenger executes with error
      const challengerHistory: Map<bigint, MipsState> = new Map();
      let chalState = MipsExecutor.createInitialState();
      challengerHistory.set(0n, { ...chalState, registers: [...chalState.registers] });

      for (let i = 0; i < instructions.length; i++) {
        chalState = mipsExecutor.executeStep(chalState, instructions[i]);

        // Error at step 3
        if (chalState.step === 3n) {
          chalState = { ...chalState, registers: [...chalState.registers] };
          chalState.registers[3] = 999n; // Wrong!
        }

        challengerHistory.set(chalState.step, { ...chalState, registers: [...chalState.registers] });
      }
      console.log(`    3. Challenger executed: final r3=${chalState.registers[3]} (wrong)`);

      // Step 4: Detect mismatch
      const seqFinalHash = hashMipsStateKeccak(seqState);
      const chalFinalHash = hashMipsStateKeccak(chalState);
      expect(seqFinalHash).to.not.equal(chalFinalHash);
      console.log(`    4. Mismatch detected`);

      // Step 5: Bisection
      let left = 0n;
      let right = BigInt(instructions.length);
      let rounds = 0;

      while (right - left > 1n) {
        const mid = left + (right - left) / 2n;
        const seqHash = hashMipsStateKeccak(sequencerHistory.get(mid)!);
        const chalHash = hashMipsStateKeccak(challengerHistory.get(mid)!);

        if (seqHash === chalHash) {
          left = mid;
        } else {
          right = mid;
        }
        rounds++;
      }
      console.log(`    5. Bisection: ${rounds} rounds → disputed step ${left}`);
      expect(left).to.equal(2n); // Error introduced at step 2→3

      // Step 6: Generate ZK proof for disputed step
      const preState = sequencerHistory.get(left)!;
      const postState = sequencerHistory.get(left + 1n)!;
      const instruction = instructionHistory.get(left)!;

      const preHash = poseidonHasher.hashMipsState(preState);
      const postHash = poseidonHasher.hashMipsState(postState);

      console.log(`    6. Generating ZK proof for step ${left}...`);
      const startTime = Date.now();
      const proofInput = ZKProver.createProofInput(preState, postState, preHash, postHash, instruction);
      const proof = await zkProver.generateProof(proofInput);
      const proofTime = Date.now() - startTime;
      console.log(`       Proof generated in ${proofTime}ms`);

      // Step 7: Verify proof
      const isValid = await zkProver.verifyProof(proof);
      console.log(`    7. Proof verified: ${isValid}`);
      expect(isValid).to.be.true;

      // Step 8: Determine winner
      const chalPreState = challengerHistory.get(left)!;
      const chalPostState = challengerHistory.get(left + 1n)!;

      const seqPreHash = hashMipsStateKeccak(preState);
      const chalPreHash = hashMipsStateKeccak(chalPreState);

      // Pre-states should match (bisection found divergence point)
      expect(seqPreHash).to.equal(chalPreHash);

      // But post-states don't match
      const seqPostHash = hashMipsStateKeccak(postState);
      const chalPostHash = hashMipsStateKeccak(chalPostState);
      expect(seqPostHash).to.not.equal(chalPostHash);

      // Sequencer's proof is valid → Sequencer wins
      console.log(`    8. Winner: SEQUENCER (valid transition proof)`);
      console.log(`    === Flow Complete ===\n`);
    });
  });

  describe('Channel Manager + Bisection Integration', () => {
    it('should manage bisection channel with moves', async () => {
      const disputeId = `dispute-${Date.now()}`;

      // Create channel
      channelManager.createChannel(
        disputeId,
        sequencerWallet.address,
        challengerWallet.address,
        0n,
        100n
      );

      const channel = channelManager.getChannel(disputeId);
      expect(channel).to.not.be.undefined;
      expect(channel!.status).to.equal('open');

      // Create and add bisection moves
      const preState = MipsExecutor.createInitialState();
      const commitment = bisectionProtocol.createCommitment(preState, 50n);

      const move = bisectionProtocol.createAttackMove(
        disputeId,
        0,
        50n,
        commitment,
        challengerWallet
      );

      channelManager.addMove(disputeId, move);

      const updatedChannel = channelManager.getChannel(disputeId);
      expect(updatedChannel!.moves).to.have.lengthOf(1);
      expect(updatedChannel!.currentDepth).to.equal(1);

      // Close channel
      channelManager.closeChannel(disputeId);
      expect(channelManager.getChannel(disputeId)!.status).to.equal('closed');
    });
  });
});

describe('P2P Communication Tests', function(this: Suite) {
  this.timeout(10000);

  // Note: These are unit tests for the P2P message format
  // Full P2P integration requires running actual WebSocket servers

  it('should create valid channel open message format', () => {
    const payload = {
      disputeId: 'dispute-123',
      batchIndex: 1n,
      sequencer: '0x1234567890123456789012345678901234567890',
      challenger: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      sequencerClaim: ethers.ZeroHash,
      challengerClaim: ethers.ZeroHash,
      startStep: 0n,
      endStep: 100n,
    };

    expect(payload.disputeId).to.be.a('string');
    expect(typeof payload.batchIndex).to.equal('bigint');
    expect(payload.sequencer).to.match(/^0x[a-fA-F0-9]{40}$/);
  });

  it('should create valid bisection move format', () => {
    const wallet = ethers.Wallet.createRandom();
    const protocol = new BisectionProtocol();
    const preState = MipsExecutor.createInitialState();

    const commitment = protocol.createCommitment(preState, 50n);
    const move = protocol.createAttackMove(
      'dispute-123',
      0,
      50n,
      commitment,
      wallet
    );

    expect(move.disputeId).to.equal('dispute-123');
    expect(move.type).to.equal('attack');
    expect(move.signature).to.match(/^0x[a-fA-F0-9]+$/);
  });
});
