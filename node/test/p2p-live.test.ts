/**
 * P2P Live Communication Tests
 *
 * Tests actual WebSocket communication between sequencer and challenger nodes
 */

import { expect } from 'chai';
import { ethers } from 'ethers';
import type { Suite } from 'mocha';
import { P2PNode, ChannelOpenPayload, BisectionMovePayload, ProofRequestPayload } from '../src/common/p2p';
import { BisectionProtocol } from '../src/common/bisection';
import { MipsExecutor } from '../src/common/mips';

describe('P2P Live Communication Tests', function(this: Suite) {
  this.timeout(30000);

  let sequencerWallet: ethers.HDNodeWallet;
  let challengerWallet: ethers.HDNodeWallet;
  let sequencerNode: P2PNode;
  let challengerNode: P2PNode;
  const PORT = 8545 + Math.floor(Math.random() * 1000); // Random port to avoid conflicts

  // Message tracking
  const receivedMessages: {
    sequencer: Array<{ type: string; payload: unknown; from: string }>;
    challenger: Array<{ type: string; payload: unknown; from: string }>;
  } = {
    sequencer: [],
    challenger: [],
  };

  before(async function() {
    // Create test wallets
    sequencerWallet = ethers.Wallet.createRandom();
    challengerWallet = ethers.Wallet.createRandom();

    // Create sequencer node (server)
    sequencerNode = new P2PNode(sequencerWallet as unknown as ethers.Wallet, {
      onChannelOpen: async (payload, from) => {
        receivedMessages.sequencer.push({ type: 'channel_open', payload, from });
      },
      onChannelAck: async (payload, from) => {
        receivedMessages.sequencer.push({ type: 'channel_ack', payload, from });
      },
      onBisectionMove: async (payload, from) => {
        receivedMessages.sequencer.push({ type: 'bisection_move', payload, from });
      },
      onProofRequest: async (payload, from) => {
        receivedMessages.sequencer.push({ type: 'proof_request', payload, from });
      },
      onProofSubmit: async (payload, from) => {
        receivedMessages.sequencer.push({ type: 'proof_submit', payload, from });
      },
      onChannelClose: async (payload, from) => {
        receivedMessages.sequencer.push({ type: 'channel_close', payload, from });
      },
    });

    // Create challenger node (client)
    challengerNode = new P2PNode(challengerWallet as unknown as ethers.Wallet, {
      onChannelOpen: async (payload, from) => {
        receivedMessages.challenger.push({ type: 'channel_open', payload, from });
      },
      onChannelAck: async (payload, from) => {
        receivedMessages.challenger.push({ type: 'channel_ack', payload, from });
      },
      onBisectionMove: async (payload, from) => {
        receivedMessages.challenger.push({ type: 'bisection_move', payload, from });
      },
      onProofRequest: async (payload, from) => {
        receivedMessages.challenger.push({ type: 'proof_request', payload, from });
      },
      onProofSubmit: async (payload, from) => {
        receivedMessages.challenger.push({ type: 'proof_submit', payload, from });
      },
      onChannelClose: async (payload, from) => {
        receivedMessages.challenger.push({ type: 'channel_close', payload, from });
      },
    });

    // Start sequencer server
    sequencerNode.startServer(PORT);

    // Wait a bit for server to start
    await new Promise(resolve => setTimeout(resolve, 100));

    // Connect challenger to sequencer
    await challengerNode.connect(`ws://localhost:${PORT}`, sequencerWallet.address);

    // Wait for connection to establish
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  after(async function() {
    // Clean up
    challengerNode.close();
    sequencerNode.close();
    // Give time for cleanup
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  beforeEach(function() {
    // Clear received messages before each test
    receivedMessages.sequencer = [];
    receivedMessages.challenger = [];
  });

  describe('Connection Management', () => {
    it('should establish WebSocket connection', () => {
      expect(challengerNode.isConnected(sequencerWallet.address)).to.be.true;
    });

    it('should track connected peers', () => {
      const challengerPeers = challengerNode.getConnectedPeers();
      expect(challengerPeers).to.include(sequencerWallet.address);
    });
  });

  describe('Channel Open Flow', () => {
    it('should send and receive channel_open message', async () => {
      const disputeId = `dispute-${Date.now()}`;
      const payload: ChannelOpenPayload = {
        disputeId,
        batchIndex: 1n,
        sequencer: sequencerWallet.address,
        challenger: challengerWallet.address,
        sequencerClaim: ethers.ZeroHash,
        challengerClaim: ethers.ZeroHash,
        startStep: 0n,
        endStep: 100n,
      };

      // Challenger opens channel with sequencer
      await challengerNode.send(sequencerWallet.address, 'channel_open', payload);

      // Wait for message delivery
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check sequencer received the message
      expect(receivedMessages.sequencer.length).to.be.greaterThan(0);
      const received = receivedMessages.sequencer.find(m => m.type === 'channel_open');
      expect(received).to.not.be.undefined;
      expect(received!.from.toLowerCase()).to.equal(challengerWallet.address.toLowerCase());
    });

    it('should send and receive channel_ack message', async () => {
      const payload = {
        disputeId: `dispute-${Date.now()}`,
        accepted: true,
      };

      // Sequencer sends ack to challenger
      await sequencerNode.send(challengerWallet.address, 'channel_ack', payload);

      // Wait for message delivery
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check challenger received the message
      const received = receivedMessages.challenger.find(m => m.type === 'channel_ack');
      expect(received).to.not.be.undefined;
      expect((received!.payload as { accepted: boolean }).accepted).to.be.true;
    });
  });

  describe('Bisection Move Exchange', () => {
    it('should exchange bisection moves', async () => {
      const protocol = new BisectionProtocol();
      const preState = MipsExecutor.createInitialState();
      const commitment = protocol.createCommitment(preState, 50n);

      const move = protocol.createAttackMove(
        `dispute-${Date.now()}`,
        0,
        50n,
        commitment,
        challengerWallet as unknown as ethers.Wallet
      );

      const payload: BisectionMovePayload = { move };

      // Challenger sends move to sequencer
      await challengerNode.send(sequencerWallet.address, 'bisection_move', payload);

      // Wait for message delivery
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check sequencer received the move
      const received = receivedMessages.sequencer.find(m => m.type === 'bisection_move');
      expect(received).to.not.be.undefined;
      expect((received!.payload as BisectionMovePayload).move.type).to.equal('attack');
    });

    it('should handle multiple bisection rounds', async () => {
      const protocol = new BisectionProtocol();
      const disputeId = `dispute-${Date.now()}`;

      // Simulate multiple bisection rounds
      for (let round = 0; round < 3; round++) {
        const preState = MipsExecutor.createInitialState();
        const step = BigInt(50 >> round);
        const commitment = protocol.createCommitment(preState, step);

        const move = protocol.createAttackMove(
          disputeId,
          round,
          step,
          commitment,
          challengerWallet as unknown as ethers.Wallet
        );

        await challengerNode.send(sequencerWallet.address, 'bisection_move', { move });

        // Wait for delivery
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Wait for all messages
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have received all 3 moves
      const bisectionMoves = receivedMessages.sequencer.filter(m => m.type === 'bisection_move');
      expect(bisectionMoves.length).to.equal(3);
    });
  });

  describe('Proof Request/Submit Flow', () => {
    it('should send proof request', async () => {
      const payload: ProofRequestPayload = {
        disputeId: `dispute-${Date.now()}`,
        disputedStep: 42n,
        preStateHash: ethers.keccak256(ethers.toUtf8Bytes('pre')),
        postStateHash: ethers.keccak256(ethers.toUtf8Bytes('post')),
      };

      // Challenger requests proof from sequencer
      await challengerNode.send(sequencerWallet.address, 'proof_request', payload);

      // Wait for delivery
      await new Promise(resolve => setTimeout(resolve, 100));

      const received = receivedMessages.sequencer.find(m => m.type === 'proof_request');
      expect(received).to.not.be.undefined;
      // BigInt values are serialized as strings over WebSocket
      expect((received!.payload as { disputedStep: string | bigint }).disputedStep.toString()).to.equal('42');
    });

    it('should send proof submission', async () => {
      const payload = {
        disputeId: `dispute-${Date.now()}`,
        proof: {
          a: ['0x123...', '0x456...'] as [string, string],
          b: [['0x111...', '0x222...'], ['0x333...', '0x444...']] as [[string, string], [string, string]],
          c: ['0x555...', '0x666...'] as [string, string],
        },
        publicInputs: ['0x001', '0x002', '0x003'],
      };

      // Sequencer submits proof to challenger
      await sequencerNode.send(challengerWallet.address, 'proof_submit', payload);

      // Wait for delivery
      await new Promise(resolve => setTimeout(resolve, 100));

      const received = receivedMessages.challenger.find(m => m.type === 'proof_submit');
      expect(received).to.not.be.undefined;
      expect((received!.payload as typeof payload).publicInputs.length).to.equal(3);
    });
  });

  describe('Channel Close', () => {
    it('should send channel close with winner', async () => {
      const payload = {
        disputeId: `dispute-${Date.now()}`,
        reason: 'completed' as const,
        winner: 'sequencer' as const,
      };

      await sequencerNode.send(challengerWallet.address, 'channel_close', payload);

      // Wait for delivery
      await new Promise(resolve => setTimeout(resolve, 100));

      const received = receivedMessages.challenger.find(m => m.type === 'channel_close');
      expect(received).to.not.be.undefined;
      expect((received!.payload as typeof payload).winner).to.equal('sequencer');
    });
  });

  describe('Full Dispute Resolution via P2P', () => {
    it('should complete entire dispute resolution flow over WebSocket', async () => {
      const disputeId = `dispute-${Date.now()}`;
      const protocol = new BisectionProtocol();

      console.log('\n    === P2P Dispute Resolution Flow ===');

      // Step 1: Challenger opens channel
      console.log('    1. Challenger opens dispute channel');
      const openPayload: ChannelOpenPayload = {
        disputeId,
        batchIndex: 1n,
        sequencer: sequencerWallet.address,
        challenger: challengerWallet.address,
        sequencerClaim: ethers.keccak256(ethers.toUtf8Bytes('seq_claim')),
        challengerClaim: ethers.keccak256(ethers.toUtf8Bytes('chal_claim')),
        startStep: 0n,
        endStep: 64n,
      };
      await challengerNode.send(sequencerWallet.address, 'channel_open', openPayload);
      await new Promise(resolve => setTimeout(resolve, 50));

      // Step 2: Sequencer acknowledges
      console.log('    2. Sequencer acknowledges');
      await sequencerNode.send(challengerWallet.address, 'channel_ack', {
        disputeId,
        accepted: true,
      });
      await new Promise(resolve => setTimeout(resolve, 50));

      // Step 3: Bisection rounds (simulated)
      console.log('    3. Bisection rounds');
      let left = 0n;
      let right = 64n;
      let round = 0;

      while (right - left > 1n) {
        const mid = left + (right - left) / 2n;
        const preState = MipsExecutor.createInitialState();
        const commitment = protocol.createCommitment(preState, mid);

        const move = protocol.createAttackMove(
          disputeId,
          round,
          mid,
          commitment,
          challengerWallet as unknown as ethers.Wallet
        );

        await challengerNode.send(sequencerWallet.address, 'bisection_move', { move });
        await new Promise(resolve => setTimeout(resolve, 30));

        // Simulate decision (always narrow to right half for this test)
        left = mid;
        round++;
      }
      console.log(`       ${round} rounds → disputed step ${left}`);

      // Step 4: Request proof
      console.log('    4. Requesting ZK proof');
      await challengerNode.send(sequencerWallet.address, 'proof_request', {
        disputeId,
        disputedStep: left,
        preStateHash: ethers.ZeroHash,
        postStateHash: ethers.ZeroHash,
      });
      await new Promise(resolve => setTimeout(resolve, 50));

      // Step 5: Submit proof (simulated)
      console.log('    5. Sequencer submits proof');
      await sequencerNode.send(challengerWallet.address, 'proof_submit', {
        disputeId,
        proof: {
          a: ['1', '2'] as [string, string],
          b: [['3', '4'], ['5', '6']] as [[string, string], [string, string]],
          c: ['7', '8'] as [string, string],
        },
        publicInputs: ['0', '1'],
      });
      await new Promise(resolve => setTimeout(resolve, 50));

      // Step 6: Close channel
      console.log('    6. Closing channel - Sequencer wins');
      await sequencerNode.send(challengerWallet.address, 'channel_close', {
        disputeId,
        reason: 'completed',
        winner: 'sequencer',
      });
      await new Promise(resolve => setTimeout(resolve, 50));

      console.log('    === Flow Complete ===\n');

      // Verify all messages were exchanged
      expect(receivedMessages.sequencer.length).to.be.greaterThan(0);
      expect(receivedMessages.challenger.length).to.be.greaterThan(0);

      // Verify channel close was received
      const closeMsg = receivedMessages.challenger.find(m => m.type === 'channel_close');
      expect(closeMsg).to.not.be.undefined;
      expect((closeMsg!.payload as { winner?: string }).winner).to.equal('sequencer');
    });
  });
});
