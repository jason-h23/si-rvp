/**
 * SequencerNode Unit Tests
 */

import { expect } from 'chai';
import { ethers } from 'ethers';
import { SequencerNode } from '../src/sequencer/index';
import { MipsExecutor, MipsInstructionBuilder } from '../src/common/mips';
import { BisectionProtocol, ChannelManager } from '../src/common/bisection';
import { ProgramExecutor } from '../src/common/executor';
import { MipsState, ZKProof, DEFAULT_CONFIG } from '../src/common/types';
import { DisputeStatus } from '../src/common/contracts';
import {
  createSequencerConfig,
  createSequencerMocks,
  createMockDisputeInfo,
  createDummyZKProof,
} from './helpers/mock-factory';

describe('SequencerNode', () => {
  let node: SequencerNode;
  let mocks: ReturnType<typeof createSequencerMocks>;
  let wallet: ethers.HDNodeWallet;

  beforeEach(() => {
    const setup = createSequencerConfig();
    wallet = setup.wallet;
    node = new SequencerNode(setup.config);
    mocks = createSequencerMocks();

    // Monkey-patch external I/O dependencies
    (node as any).rollupManager = mocks.rollupManager;
    (node as any).disputeManager = mocks.disputeManager;
    (node as any).p2pNode = mocks.p2pNode;
    (node as any).zkProver = mocks.zkProver;
    (node as any).poseidonHasher = mocks.poseidonHasher;
    // The node builds its ProgramExecutor in the constructor, capturing the
    // real PoseidonHasher; swapping the field above leaves that executor
    // holding an uninitialised hasher. Rebuild it against the mock.
    (node as any).programExecutor = new ProgramExecutor(
      new MipsExecutor(),
      mocks.poseidonHasher as any
    );
  });

  // ============================================
  // Constructor
  // ============================================
  describe('constructor', () => {
    it('should create with valid config', () => {
      expect(node).to.be.instanceOf(SequencerNode);
    });

    it('should have empty state history initially', () => {
      expect((node as any).stateHistory.size).to.equal(0);
    });

    it('should have empty active disputes initially', () => {
      expect((node as any).activeDisputes.size).to.equal(0);
    });
  });

  // ============================================
  // Initialize
  // ============================================
  describe('initialize', () => {
    it('should call zkProver.initialize', async () => {
      await node.initialize();
      const initCalls = mocks.zkProver._calls.filter(c => c.method === 'initialize');
      expect(initCalls).to.have.lengthOf(1);
    });

    it('should call poseidonHasher.initialize', async () => {
      await node.initialize();
      const initCalls = mocks.poseidonHasher._calls.filter(c => c.method === 'initialize');
      expect(initCalls).to.have.lengthOf(1);
    });

    it('should start P2P server on configured port', async () => {
      await node.initialize();
      expect(mocks.p2pNode._serverPort).to.equal(9999);
    });

    it('should setup dispute event listeners', async () => {
      await node.initialize();
      expect(mocks.disputeManager._disputeInitiatedCb).to.be.a('function');
      expect(mocks.disputeManager._proofSubmittedCb).to.be.a('function');
      expect(mocks.disputeManager._disputeResolvedCb).to.be.a('function');
    });
  });

  // ============================================
  // executeProgram
  // ============================================
  describe('executeProgram', () => {
    it('should execute instructions and return final state', async () => {
      // addi $1, $0, 42  → rt=1, rs=0, imm=42
      const instructions = [MipsInstructionBuilder.addi(1, 0, 42)];
      const { finalState } = await node.executeProgram(instructions);
      expect(finalState.registers[1]).to.equal(42n);
    });

    it('should store state history for each step', async () => {
      const instructions = [
        MipsInstructionBuilder.addi(1, 0, 10),
        MipsInstructionBuilder.addi(2, 0, 20),
      ];
      await node.executeProgram(instructions);
      const history = (node as any).stateHistory as Map<bigint, MipsState>;
      // initial state (step 0) + 2 instructions = 3 entries
      expect(history.size).to.equal(3);
      expect(history.has(0n)).to.be.true;
      expect(history.has(1n)).to.be.true;
      expect(history.has(2n)).to.be.true;
    });

    it('should store instruction history', async () => {
      const inst = MipsInstructionBuilder.addi(1, 0, 10);
      await node.executeProgram([inst]);
      const instHistory = (node as any).instructionHistory as Map<bigint, bigint>;
      expect(instHistory.has(0n)).to.be.true;
      expect(instHistory.get(0n)).to.equal(inst);
    });

    it('should use default initial state when none provided', async () => {
      const { finalState } = await node.executeProgram([]);
      expect(finalState.pc).to.equal(0n);
      expect(finalState.step).to.equal(0n);
    });

    it('should use provided initial state', async () => {
      const customState = MipsExecutor.createInitialState(100n);
      const { finalState } = await node.executeProgram([], customState);
      expect(finalState.pc).to.equal(100n);
    });

    it('should calculate state root from final state hash', async () => {
      const { stateRoot } = await node.executeProgram([MipsInstructionBuilder.addi(1, 0, 5)]);
      expect(stateRoot).to.match(/^0x[0-9a-f]{64}$/);
    });

    it('should not mutate original registers in state history', async () => {
      const instructions = [
        MipsInstructionBuilder.addi(1, 0, 10),
        MipsInstructionBuilder.addi(2, 0, 20),
      ];
      await node.executeProgram(instructions);
      const history = (node as any).stateHistory as Map<bigint, MipsState>;
      const step0 = history.get(0n)!;
      const step1 = history.get(1n)!;
      // Step 0 should still have $1 = 0
      expect(step0.registers[1]).to.equal(0n);
      // Step 1 should have $1 = 10
      expect(step1.registers[1]).to.equal(10n);
    });
  });

  // ============================================
  // submitStateRoot
  // ============================================
  describe('submitStateRoot', () => {
    it('should call rollupManager.proposeStateRoot with correct args', async () => {
      const txHash = await node.submitStateRoot('0xabc', 5n);
      const calls = mocks.rollupManager._calls.filter(c => c.method === 'proposeStateRoot');
      expect(calls).to.have.lengthOf(1);
      expect(calls[0].args[0]).to.equal('0xabc');
      expect(calls[0].args[1]).to.equal(5n);
    });

    it('should return transaction hash', async () => {
      const txHash = await node.submitStateRoot('0xabc', 5n);
      expect(txHash).to.equal('0xtxhash_propose');
    });
  });

  // ============================================
  // onChannelOpen
  // ============================================
  describe('onChannelOpen', () => {
    it('should reject if no active dispute for disputeId', async () => {
      const payload = {
        disputeId: '1',
        batchIndex: 1n,
        sequencer: wallet.address,
        challenger: ethers.ZeroAddress,
        sequencerClaim: ethers.ZeroHash,
        challengerClaim: ethers.ZeroHash,
        startStep: 0n,
        endStep: 100n,
      };
      await node.onChannelOpen(payload, ethers.ZeroAddress);
      // No channel should be created
      const channel = (node as any).channelManager.getChannel('1');
      expect(channel).to.be.undefined;
    });

    it('should reject if challenger address does not match dispute', async () => {
      const disputeInfo = createMockDisputeInfo({ challenger: '0x1111111111111111111111111111111111111111' });
      (node as any).activeDisputes.set(1n, disputeInfo);

      const payload = {
        disputeId: '1',
        batchIndex: 1n,
        sequencer: wallet.address,
        challenger: '0x2222222222222222222222222222222222222222',
        sequencerClaim: ethers.ZeroHash,
        challengerClaim: ethers.ZeroHash,
        startStep: 0n,
        endStep: 100n,
      };
      // 'from' is different from dispute.challenger
      await node.onChannelOpen(payload, '0x2222222222222222222222222222222222222222');
      const channel = (node as any).channelManager.getChannel('1');
      expect(channel).to.be.undefined;
    });

    it('should create channel and send channel_ack on valid request', async () => {
      const challengerAddr = '0x1111111111111111111111111111111111111111';
      const disputeInfo = createMockDisputeInfo({ challenger: challengerAddr });
      (node as any).activeDisputes.set(1n, disputeInfo);

      const payload = {
        disputeId: '1',
        batchIndex: 1n,
        sequencer: wallet.address,
        challenger: challengerAddr,
        sequencerClaim: ethers.ZeroHash,
        challengerClaim: ethers.ZeroHash,
        startStep: 0n,
        endStep: 100n,
      };
      await node.onChannelOpen(payload, challengerAddr);

      // Channel should be created
      const channel = (node as any).channelManager.getChannel('1');
      expect(channel).to.not.be.undefined;
      expect(channel.startStep).to.equal(0n);
      expect(channel.endStep).to.equal(100n);

      // Should send channel_ack
      const ackMessages = mocks.p2pNode._sent.filter(m => m.type === 'channel_ack');
      expect(ackMessages).to.have.lengthOf(1);
      expect(ackMessages[0].payload.accepted).to.be.true;
      expect(ackMessages[0].to).to.equal(challengerAddr);
    });
  });

  // ============================================
  // onBisectionMove
  // ============================================
  describe('onBisectionMove', () => {
    let challengerWallet: ethers.HDNodeWallet;
    let bisectionProtocol: BisectionProtocol;

    beforeEach(() => {
      challengerWallet = ethers.Wallet.createRandom();
      bisectionProtocol = new BisectionProtocol();
    });

    it('should reject if channel not found', async () => {
      const claim = bisectionProtocol.createCommitment(MipsExecutor.createInitialState(), 50n);
      const move = bisectionProtocol.createAttackMove('nonexistent', 0, 50n, claim, challengerWallet);
      await node.onBisectionMove({ move }, challengerWallet.address);
      // No crash, just returns silently
      expect(mocks.p2pNode._sent).to.have.lengthOf(0);
    });

    it('should reject if move signature is invalid', async () => {
      // Create channel first
      const challengerAddr = challengerWallet.address;
      (node as any).channelManager.createChannel('d1', wallet.address, challengerAddr, 0n, 100n);

      // Create move signed by a DIFFERENT wallet
      const imposter = ethers.Wallet.createRandom();
      const claim = bisectionProtocol.createCommitment(MipsExecutor.createInitialState(), 50n);
      const move = bisectionProtocol.createAttackMove('d1', 0, 50n, claim, imposter);

      await node.onBisectionMove({ move }, challengerAddr);
      // Should not send any response
      expect(mocks.p2pNode._sent).to.have.lengthOf(0);
    });

    it('should record move in channel manager', async () => {
      const challengerAddr = challengerWallet.address;
      (node as any).channelManager.createChannel('d1', wallet.address, challengerAddr, 0n, 100n);

      // Populate state history so sequencer can defend
      const instructions = [MipsInstructionBuilder.addi(1, 0, 10)];
      await node.executeProgram(instructions);

      const state = MipsExecutor.createInitialState();
      const claim = bisectionProtocol.createCommitment(state, 50n);
      const move = bisectionProtocol.createAttackMove('d1', 0, 50n, claim, challengerWallet);

      await node.onBisectionMove({ move }, challengerAddr);

      const channel = (node as any).channelManager.getChannel('d1');
      // At least the attack move should be recorded
      expect(channel.moves.length).to.be.at.least(1);
      expect(channel.moves[0].type).to.equal('attack');
    });

    it('should send defend move when bisection continues', async () => {
      const challengerAddr = challengerWallet.address;
      (node as any).channelManager.createChannel('d1', wallet.address, challengerAddr, 0n, 1000n);

      // Populate state at step 50
      const stateAt50 = MipsExecutor.createInitialState();
      (node as any).stateHistory.set(50n, stateAt50);

      const claim = bisectionProtocol.createCommitment(stateAt50, 50n);
      const move = bisectionProtocol.createAttackMove('d1', 0, 50n, claim, challengerWallet);

      await node.onBisectionMove({ move }, challengerAddr);

      // Should send a defend bisection_move back
      const bisectionMessages = mocks.p2pNode._sent.filter(m => m.type === 'bisection_move');
      expect(bisectionMessages).to.have.lengthOf(1);
      expect(bisectionMessages[0].payload.move.type).to.equal('defend');
    });

    it('should handle bisection completion at max depth', async () => {
      const challengerAddr = challengerWallet.address;
      const channel = (node as any).channelManager.createChannel('d1', wallet.address, challengerAddr, 0n, 100n);

      const state = MipsExecutor.createInitialState();
      const claim = bisectionProtocol.createCommitment(state, 50n);
      // depth >= maxDepth - 1 triggers completion
      const move = bisectionProtocol.createAttackMove('d1', channel.maxDepth - 1, 50n, claim, challengerWallet);

      await node.onBisectionMove({ move }, challengerAddr);

      // Should update channel status to awaiting_proof
      const updatedChannel = (node as any).channelManager.getChannel('d1');
      expect(updatedChannel.status).to.equal('awaiting_proof');
    });

    it('should not send defend when state not found', async () => {
      const challengerAddr = challengerWallet.address;
      (node as any).channelManager.createChannel('d1', wallet.address, challengerAddr, 0n, 1000n);

      // Don't populate stateHistory for step 50
      const state = MipsExecutor.createInitialState();
      const claim = bisectionProtocol.createCommitment(state, 50n);
      const move = bisectionProtocol.createAttackMove('d1', 0, 50n, claim, challengerWallet);

      await node.onBisectionMove({ move }, challengerAddr);

      // No defend should be sent (state at step 50 not found)
      const bisectionMessages = mocks.p2pNode._sent.filter(m => m.type === 'bisection_move');
      expect(bisectionMessages).to.have.lengthOf(0);
    });
  });

  // ============================================
  // onProofRequest
  // ============================================
  describe('onProofRequest', () => {
    it('should generate and send ZK proof for disputed step', async () => {
      // Execute a program to populate state+instruction history
      const instructions = [
        MipsInstructionBuilder.addi(1, 0, 10),
        MipsInstructionBuilder.addi(2, 0, 20),
      ];
      await node.executeProgram(instructions);

      const payload = {
        disputeId: '1',
        disputedStep: 0n,
        preStateHash: '0x00',
        postStateHash: '0x01',
      };

      await node.onProofRequest(payload, '0xchallenger');

      // Should have called zkProver.generateProof
      const proofCalls = mocks.zkProver._calls.filter(c => c.method === 'generateProof');
      expect(proofCalls).to.have.lengthOf(1);

      // Should have sent proof_submit
      const proofMessages = mocks.p2pNode._sent.filter(m => m.type === 'proof_submit');
      expect(proofMessages).to.have.lengthOf(1);
      expect(proofMessages[0].to).to.equal('0xchallenger');
    });

    it('should handle missing state data gracefully', async () => {
      // Don't populate any state history
      const payload = {
        disputeId: '1',
        disputedStep: 999n,
        preStateHash: '0x00',
        postStateHash: '0x01',
      };

      await node.onProofRequest(payload, '0xchallenger');

      // Should not crash, should not send proof
      expect(mocks.p2pNode._sent).to.have.lengthOf(0);
      expect(mocks.zkProver._calls.filter(c => c.method === 'generateProof')).to.have.lengthOf(0);
    });

    it('should handle missing instruction data gracefully', async () => {
      // Populate state but not instruction at a step
      const state0 = MipsExecutor.createInitialState();
      const state1 = MipsExecutor.createInitialState(4n);
      (node as any).stateHistory.set(5n, state0);
      (node as any).stateHistory.set(6n, state1);
      // instructionHistory does NOT have step 5

      const payload = {
        disputeId: '1',
        disputedStep: 5n,
        preStateHash: '0x00',
        postStateHash: '0x01',
      };

      await node.onProofRequest(payload, '0xchallenger');
      expect(mocks.p2pNode._sent).to.have.lengthOf(0);
    });
  });

  // ============================================
  // submitProofOnchain
  // ============================================
  describe('submitProofOnchain', () => {
    it('should call disputeManager.submitProof', async () => {
      const proof = createDummyZKProof();
      await node.submitProofOnchain(1n, proof);
      const calls = mocks.disputeManager._calls.filter(c => c.method === 'submitProof');
      expect(calls).to.have.lengthOf(1);
      expect(calls[0].args[0]).to.equal(1n);
    });

    it('should return transaction hash', async () => {
      const proof = createDummyZKProof();
      const txHash = await node.submitProofOnchain(1n, proof);
      expect(txHash).to.equal('0xtxhash_proof');
    });
  });

  // ============================================
  // shutdown
  // ============================================
  describe('shutdown', () => {
    it('should remove all listeners and close P2P', async () => {
      await node.shutdown();

      const rmCalls1 = mocks.rollupManager._calls.filter(c => c.method === 'removeAllListeners');
      expect(rmCalls1).to.have.lengthOf(1);

      const rmCalls2 = mocks.disputeManager._calls.filter(c => c.method === 'removeAllListeners');
      expect(rmCalls2).to.have.lengthOf(1);

      const closeCalls = mocks.p2pNode._calls.filter(c => c.method === 'close');
      expect(closeCalls).to.have.lengthOf(1);
    });
  });
});
