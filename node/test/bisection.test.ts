/**
 * Bisection Protocol Unit Tests
 */

import { expect } from 'chai';
import { ethers, HDNodeWallet } from 'ethers';
import { BisectionProtocol, ChannelManager } from '../src/common/bisection';
import { MipsExecutor } from '../src/common/mips';
import { MipsState, BisectionMove, ChannelState } from '../src/common/types';

describe('Bisection Protocol', () => {
  let protocol: BisectionProtocol;
  let wallet: HDNodeWallet;

  beforeEach(() => {
    protocol = new BisectionProtocol(10, 60);
    wallet = ethers.Wallet.createRandom();
  });

  // ============================================
  // calculateDisputeRange Tests
  // ============================================
  describe('calculateDisputeRange', () => {
    it('should calculate midpoint correctly', () => {
      const result = protocol.calculateDisputeRange(0, 0n, 100n);

      expect(result.midpoint).to.equal(50n);
      expect(result.leftStart).to.equal(0n);
      expect(result.leftEnd).to.equal(50n);
      expect(result.rightStart).to.equal(50n);
      expect(result.rightEnd).to.equal(100n);
    });

    it('should handle odd ranges', () => {
      const result = protocol.calculateDisputeRange(0, 0n, 99n);

      expect(result.midpoint).to.equal(49n);
      expect(result.leftEnd).to.equal(49n);
      expect(result.rightStart).to.equal(49n);
    });

    it('should handle small ranges', () => {
      const result = protocol.calculateDisputeRange(0, 5n, 7n);

      expect(result.midpoint).to.equal(6n);
    });

    it('should handle range of 2', () => {
      const result = protocol.calculateDisputeRange(0, 0n, 2n);

      expect(result.midpoint).to.equal(1n);
    });

    it('should handle large ranges', () => {
      const result = protocol.calculateDisputeRange(0, 0n, BigInt(2 ** 64));

      expect(result.midpoint).to.equal(BigInt(2 ** 63));
    });

    it('should handle non-zero start', () => {
      const result = protocol.calculateDisputeRange(0, 100n, 200n);

      expect(result.midpoint).to.equal(150n);
      expect(result.leftStart).to.equal(100n);
      expect(result.leftEnd).to.equal(150n);
      expect(result.rightStart).to.equal(150n);
      expect(result.rightEnd).to.equal(200n);
    });
  });

  // ============================================
  // calculateStateHash Tests
  // ============================================
  describe('calculateStateHash', () => {
    const createTestState = (): MipsState => ({
      pc: 0n,
      nextPC: 4n,
      lo: 0n,
      hi: 0n,
      registers: Array(32).fill(0n),
      memoryRoot: ethers.ZeroHash,
      step: 0n,
      exitCode: 0,
      exited: false,
      heap: 0n,
      preimageKey: ethers.ZeroHash,
      preimageOffset: 0n,
    });

    it('should generate a valid hash', () => {
      const state = createTestState();
      const hash = protocol.calculateStateHash(state);

      expect(hash).to.match(/^0x[a-f0-9]{64}$/);
    });

    it('should be consistent', () => {
      const state = createTestState();
      const hash1 = protocol.calculateStateHash(state);
      const hash2 = protocol.calculateStateHash(state);

      expect(hash1).to.equal(hash2);
    });

    it('should produce different hashes for different states', () => {
      const state1 = createTestState();
      const state2 = { ...createTestState(), pc: 100n };

      const hash1 = protocol.calculateStateHash(state1);
      const hash2 = protocol.calculateStateHash(state2);

      expect(hash1).to.not.equal(hash2);
    });
  });

  // ============================================
  // createCommitment Tests
  // ============================================
  describe('createCommitment', () => {
    it('should create valid commitment', () => {
      const state = MipsExecutor.createInitialState();
      const commitment = protocol.createCommitment(state, 5n);

      expect(commitment.stateHash).to.match(/^0x[a-f0-9]{64}$/);
      expect(commitment.step).to.equal(5n);
    });

    it('should create different commitments for different states', () => {
      const state1 = MipsExecutor.createInitialState();
      const state2 = { ...MipsExecutor.createInitialState(), pc: 100n };

      const commitment1 = protocol.createCommitment(state1, 5n);
      const commitment2 = protocol.createCommitment(state2, 5n);

      expect(commitment1.stateHash).to.not.equal(commitment2.stateHash);
    });
  });

  // ============================================
  // createAttackMove Tests
  // ============================================
  describe('createAttackMove', () => {
    it('should create valid attack move', () => {
      const state = MipsExecutor.createInitialState();
      const commitment = protocol.createCommitment(state, 5n);

      const move = protocol.createAttackMove('dispute-1', 0, 5n, commitment, wallet);

      expect(move.type).to.equal('attack');
      expect(move.disputeId).to.equal('dispute-1');
      expect(move.depth).to.equal(0);
      expect(move.position).to.equal(5n);
      expect(move.claim).to.deep.equal(commitment);
      expect(move.signature).to.match(/^0x[a-f0-9]+$/);
      expect(move.timestamp).to.be.a('number');
    });

    it('should create moves with different signatures for different wallets', () => {
      const state = MipsExecutor.createInitialState();
      const commitment = protocol.createCommitment(state, 5n);

      const wallet2 = ethers.Wallet.createRandom();

      const move1 = protocol.createAttackMove('dispute-1', 0, 5n, commitment, wallet);
      const move2 = protocol.createAttackMove('dispute-1', 0, 5n, commitment, wallet2);

      expect(move1.signature).to.not.equal(move2.signature);
    });
  });

  // ============================================
  // createDefendMove Tests
  // ============================================
  describe('createDefendMove', () => {
    it('should create valid defend move', () => {
      const state = MipsExecutor.createInitialState();
      const commitment = protocol.createCommitment(state, 5n);

      const move = protocol.createDefendMove('dispute-1', 0, 5n, commitment, wallet);

      expect(move.type).to.equal('defend');
      expect(move.disputeId).to.equal('dispute-1');
      expect(move.depth).to.equal(0);
      expect(move.position).to.equal(5n);
    });
  });

  // ============================================
  // verifyMoveSignature Tests
  // ============================================
  describe('verifyMoveSignature', () => {
    it('should verify valid signature', () => {
      const state = MipsExecutor.createInitialState();
      const commitment = protocol.createCommitment(state, 5n);

      const move = protocol.createAttackMove('dispute-1', 0, 5n, commitment, wallet);

      const isValid = protocol.verifyMoveSignature(move, wallet.address);
      expect(isValid).to.be.true;
    });

    it('should reject invalid signer', () => {
      const state = MipsExecutor.createInitialState();
      const commitment = protocol.createCommitment(state, 5n);

      const move = protocol.createAttackMove('dispute-1', 0, 5n, commitment, wallet);

      const otherWallet = ethers.Wallet.createRandom();
      const isValid = protocol.verifyMoveSignature(move, otherWallet.address);
      expect(isValid).to.be.false;
    });

    it('should reject tampered move', () => {
      const state = MipsExecutor.createInitialState();
      const commitment = protocol.createCommitment(state, 5n);

      const move = protocol.createAttackMove('dispute-1', 0, 5n, commitment, wallet);

      // Tamper with the move
      const tamperedMove: BisectionMove = {
        ...move,
        position: 10n, // Changed
      };

      const isValid = protocol.verifyMoveSignature(tamperedMove, wallet.address);
      expect(isValid).to.be.false;
    });
  });

  // ============================================
  // checkTimeout Tests
  // ============================================
  describe('checkTimeout', () => {
    it('should return false when not timed out', () => {
      const recentActivity = Date.now();
      const isTimedOut = protocol.checkTimeout(recentActivity);

      expect(isTimedOut).to.be.false;
    });

    it('should return true when timed out', () => {
      // 2 minutes ago (timeout is 60 seconds)
      const oldActivity = Date.now() - 120 * 1000;
      const isTimedOut = protocol.checkTimeout(oldActivity);

      expect(isTimedOut).to.be.true;
    });

    it('should respect custom timeout', () => {
      const shortTimeoutProtocol = new BisectionProtocol(10, 1); // 1 second timeout
      const activity = Date.now() - 2000; // 2 seconds ago

      const isTimedOut = shortTimeoutProtocol.checkTimeout(activity);
      expect(isTimedOut).to.be.true;
    });
  });

  // ============================================
  // createBisectionCommitment Tests
  // ============================================
  describe('createBisectionCommitment', () => {
    it('should create valid commitment hash', () => {
      const preStateHash = '0x' + '1'.repeat(64);
      const postStateHash = '0x' + '2'.repeat(64);

      const commitment = protocol.createBisectionCommitment(
        'dispute-1',
        5n,
        preStateHash,
        postStateHash
      );

      expect(commitment).to.match(/^0x[a-f0-9]{64}$/);
    });

    it('should be consistent', () => {
      const preStateHash = '0x' + '1'.repeat(64);
      const postStateHash = '0x' + '2'.repeat(64);

      const commitment1 = protocol.createBisectionCommitment(
        'dispute-1',
        5n,
        preStateHash,
        postStateHash
      );
      const commitment2 = protocol.createBisectionCommitment(
        'dispute-1',
        5n,
        preStateHash,
        postStateHash
      );

      expect(commitment1).to.equal(commitment2);
    });
  });
});

describe('ChannelManager', () => {
  let channelManager: ChannelManager;
  let sequencerWallet: HDNodeWallet;
  let challengerWallet: HDNodeWallet;

  beforeEach(() => {
    channelManager = new ChannelManager();
    sequencerWallet = ethers.Wallet.createRandom();
    challengerWallet = ethers.Wallet.createRandom();
  });

  // ============================================
  // createChannel Tests
  // ============================================
  describe('createChannel', () => {
    it('should create channel with correct properties', () => {
      const channel = channelManager.createChannel(
        'dispute-1',
        sequencerWallet.address,
        challengerWallet.address,
        0n,
        100n
      );

      expect(channel.channelId).to.equal('dispute-1');
      expect(channel.sequencer).to.equal(sequencerWallet.address);
      expect(channel.challenger).to.equal(challengerWallet.address);
      expect(channel.startStep).to.equal(0n);
      expect(channel.endStep).to.equal(100n);
      expect(channel.status).to.equal('open');
      expect(channel.moves).to.be.an('array').that.is.empty;
      expect(channel.currentDepth).to.equal(0);
    });

    it('should store channel for retrieval', () => {
      channelManager.createChannel(
        'dispute-1',
        sequencerWallet.address,
        challengerWallet.address,
        0n,
        100n
      );

      const retrieved = channelManager.getChannel('dispute-1');
      expect(retrieved).to.not.be.undefined;
      expect(retrieved!.channelId).to.equal('dispute-1');
    });

    it('should create multiple channels', () => {
      channelManager.createChannel(
        'dispute-1',
        sequencerWallet.address,
        challengerWallet.address,
        0n,
        100n
      );
      channelManager.createChannel(
        'dispute-2',
        sequencerWallet.address,
        challengerWallet.address,
        0n,
        200n
      );

      const ch1 = channelManager.getChannel('dispute-1');
      const ch2 = channelManager.getChannel('dispute-2');

      expect(ch1).to.not.be.undefined;
      expect(ch2).to.not.be.undefined;
      expect(ch1!.endStep).to.equal(100n);
      expect(ch2!.endStep).to.equal(200n);
    });
  });

  // ============================================
  // getChannel Tests
  // ============================================
  describe('getChannel', () => {
    it('should return undefined for non-existent channel', () => {
      const channel = channelManager.getChannel('non-existent');
      expect(channel).to.be.undefined;
    });

    it('should return existing channel', () => {
      channelManager.createChannel(
        'dispute-1',
        sequencerWallet.address,
        challengerWallet.address,
        0n,
        100n
      );

      const channel = channelManager.getChannel('dispute-1');
      expect(channel).to.not.be.undefined;
    });
  });

  // ============================================
  // updateChannel Tests
  // ============================================
  describe('updateChannel', () => {
    it('should update channel status', () => {
      channelManager.createChannel(
        'dispute-1',
        sequencerWallet.address,
        challengerWallet.address,
        0n,
        100n
      );

      channelManager.updateChannel('dispute-1', { status: 'awaiting_proof' });

      const channel = channelManager.getChannel('dispute-1');
      expect(channel!.status).to.equal('awaiting_proof');
    });

    it('should update multiple fields', () => {
      channelManager.createChannel(
        'dispute-1',
        sequencerWallet.address,
        challengerWallet.address,
        0n,
        100n
      );

      channelManager.updateChannel('dispute-1', {
        status: 'closed',
        currentDepth: 5,
      });

      const channel = channelManager.getChannel('dispute-1');
      expect(channel!.status).to.equal('closed');
      expect(channel!.currentDepth).to.equal(5);
    });

    it('should update lastActivityAt automatically', () => {
      channelManager.createChannel(
        'dispute-1',
        sequencerWallet.address,
        challengerWallet.address,
        0n,
        100n
      );

      const originalActivity = channelManager.getChannel('dispute-1')!.lastActivityAt;

      // Wait a bit
      const before = Date.now();
      channelManager.updateChannel('dispute-1', { status: 'awaiting_proof' });

      const channel = channelManager.getChannel('dispute-1');
      expect(channel!.lastActivityAt).to.be.at.least(before);
    });

    it('should not affect non-existent channel', () => {
      channelManager.updateChannel('non-existent', { status: 'closed' });
      const channel = channelManager.getChannel('non-existent');
      expect(channel).to.be.undefined;
    });
  });

  // ============================================
  // addMove Tests
  // ============================================
  describe('addMove', () => {
    it('should add move to channel', () => {
      channelManager.createChannel(
        'dispute-1',
        sequencerWallet.address,
        challengerWallet.address,
        0n,
        100n
      );

      const move: BisectionMove = {
        disputeId: 'dispute-1',
        type: 'attack',
        depth: 0,
        position: 50n,
        claim: { stateHash: '0x' + '1'.repeat(64), step: 50n },
        signature: '0x' + 'a'.repeat(130),
        timestamp: Date.now(),
      };

      channelManager.addMove('dispute-1', move);

      const channel = channelManager.getChannel('dispute-1');
      expect(channel!.moves).to.have.lengthOf(1);
      expect(channel!.moves[0]).to.deep.equal(move);
    });

    it('should update currentDepth', () => {
      channelManager.createChannel(
        'dispute-1',
        sequencerWallet.address,
        challengerWallet.address,
        0n,
        100n
      );

      const move: BisectionMove = {
        disputeId: 'dispute-1',
        type: 'attack',
        depth: 3,
        position: 50n,
        claim: { stateHash: '0x' + '1'.repeat(64), step: 50n },
        signature: '0x' + 'a'.repeat(130),
        timestamp: Date.now(),
      };

      channelManager.addMove('dispute-1', move);

      const channel = channelManager.getChannel('dispute-1');
      expect(channel!.currentDepth).to.equal(4); // depth + 1
    });

    it('should add multiple moves', () => {
      channelManager.createChannel(
        'dispute-1',
        sequencerWallet.address,
        challengerWallet.address,
        0n,
        100n
      );

      for (let i = 0; i < 5; i++) {
        const move: BisectionMove = {
          disputeId: 'dispute-1',
          type: i % 2 === 0 ? 'attack' : 'defend',
          depth: Math.floor(i / 2),
          position: BigInt(50 - i * 5),
          claim: { stateHash: '0x' + i.toString().repeat(64), step: BigInt(50 - i * 5) },
          signature: '0x' + 'a'.repeat(130),
          timestamp: Date.now(),
        };
        channelManager.addMove('dispute-1', move);
      }

      const channel = channelManager.getChannel('dispute-1');
      expect(channel!.moves).to.have.lengthOf(5);
    });
  });

  // ============================================
  // closeChannel Tests
  // ============================================
  describe('closeChannel', () => {
    it('should close channel', () => {
      channelManager.createChannel(
        'dispute-1',
        sequencerWallet.address,
        challengerWallet.address,
        0n,
        100n
      );

      channelManager.closeChannel('dispute-1');

      const channel = channelManager.getChannel('dispute-1');
      expect(channel!.status).to.equal('closed');
    });

    it('should not affect non-existent channel', () => {
      channelManager.closeChannel('non-existent');
      const channel = channelManager.getChannel('non-existent');
      expect(channel).to.be.undefined;
    });
  });
});
