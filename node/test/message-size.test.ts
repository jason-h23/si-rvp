/**
 * Message Size Analysis
 *
 * Measures serialized payload sizes for all SI-RVP protocol messages.
 * Data feeds into the paper's communication overhead analysis.
 */

import { expect } from 'chai';
import { ethers } from 'ethers';
import {
  BisectionMove,
  StateCommitment,
  P2PMessage,
} from '../src/common/types';
import {
  ChannelOpenPayload,
  ChannelAckPayload,
  BisectionMovePayload,
  ProofRequestPayload,
  ProofSubmitPayload,
  ChannelClosePayload,
} from '../src/common/p2p';

// ============================================
// Helpers
// ============================================

/** Byte length of a JSON-serialized object (UTF-8) */
function jsonByteSize(obj: unknown): number {
  return Buffer.byteLength(JSON.stringify(obj), 'utf-8');
}

/** Create a realistic ECDSA signature (65 bytes hex-encoded = 132 chars) */
function fakeSig(): string {
  return '0x' + 'ab'.repeat(65);
}

/** Create a realistic bytes32 hash */
function fakeHash(): string {
  return ethers.keccak256(ethers.toUtf8Bytes('test-' + Math.random()));
}

/** Create a realistic Ethereum address */
function fakeAddr(): string {
  return ethers.Wallet.createRandom().address;
}

// ============================================
// Message factories
// ============================================

function makeChannelOpenPayload(): ChannelOpenPayload {
  return {
    disputeId: 'dispute-' + fakeHash().slice(0, 16),
    batchIndex: 42n,
    sequencer: fakeAddr(),
    challenger: fakeAddr(),
    sequencerClaim: fakeHash(),
    challengerClaim: fakeHash(),
    startStep: 0n,
    endStep: BigInt(2 ** 73),
  };
}

function makeChannelAckPayload(): ChannelAckPayload {
  return {
    disputeId: 'dispute-' + fakeHash().slice(0, 16),
    accepted: true,
  };
}

function makeBisectionMove(depth: number): BisectionMove {
  const commitment: StateCommitment = {
    stateHash: fakeHash(),
    step: BigInt(depth * 1000),
    signature: fakeSig(),
  };
  return {
    type: 'attack',
    disputeId: 'dispute-' + fakeHash().slice(0, 16),
    depth,
    position: BigInt(2 ** depth + 1),
    claim: commitment,
    signature: fakeSig(),
    timestamp: Date.now(),
  };
}

function makeBisectionMovePayload(depth: number): BisectionMovePayload {
  return { move: makeBisectionMove(depth) };
}

function makeProofRequestPayload(): ProofRequestPayload {
  return {
    disputeId: 'dispute-' + fakeHash().slice(0, 16),
    disputedStep: 123456n,
    preStateHash: fakeHash(),
    postStateHash: fakeHash(),
  };
}

function makeProofSubmitPayload(): ProofSubmitPayload {
  // Realistic Groth16 proof: 3 group elements (a, b, c) + public inputs
  return {
    disputeId: 'dispute-' + fakeHash().slice(0, 16),
    proof: {
      a: [fakeHash(), fakeHash()],
      b: [[fakeHash(), fakeHash()], [fakeHash(), fakeHash()]],
      c: [fakeHash(), fakeHash()],
    },
    publicInputs: [fakeHash(), fakeHash()],
  };
}

function makeChannelClosePayload(): ChannelClosePayload {
  return {
    disputeId: 'dispute-' + fakeHash().slice(0, 16),
    reason: 'completed',
    winner: 'challenger',
  };
}

function wrapAsP2PMessage(type: P2PMessage['type'], payload: unknown): P2PMessage {
  return {
    type,
    payload,
    from: fakeAddr(),
    to: fakeAddr(),
    signature: fakeSig(),
    timestamp: Date.now(),
    sequence: 1,
  };
}

// BigInt JSON serializer for size measurement
function toJsonSafe(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );
}

function safeByteSize(obj: unknown): number {
  return Buffer.byteLength(toJsonSafe(obj), 'utf-8');
}

// ============================================
// Tests
// ============================================

describe('Message Size Analysis', function () {
  interface SizeEntry {
    messageType: string;
    payloadBytes: number;
    wrappedBytes: number;
  }

  const sizeTable: SizeEntry[] = [];

  after(function () {
    // Print consolidated table
    console.log('\n  ═══════════════════════════════════════════════════════════');
    console.log('  Protocol Message Size Summary');
    console.log('  ═══════════════════════════════════════════════════════════');
    console.log('  Message Type          │ Payload (B) │ Wrapped (B) │ Ratio');
    console.log('  ──────────────────────┼─────────────┼─────────────┼──────');
    for (const entry of sizeTable) {
      const ratio = (entry.wrappedBytes / entry.payloadBytes).toFixed(2);
      console.log(
        `  ${entry.messageType.padEnd(22)} │ ${entry.payloadBytes.toString().padStart(11)} │ ${entry.wrappedBytes.toString().padStart(11)} │ ${ratio.padStart(5)}`
      );
    }
    console.log('  ═══════════════════════════════════════════════════════════');

    // Bisection totals
    const bisectionEntry = sizeTable.find(e => e.messageType === 'bisection_move');
    if (bisectionEntry) {
      const totalMsgs = 73 * 2; // 73 rounds, 2 messages each
      const totalBytes = totalMsgs * bisectionEntry.wrappedBytes;
      console.log(`\n  Off-chain bisection total (${totalMsgs} messages):`);
      console.log(`    ${totalBytes.toLocaleString()} bytes (${(totalBytes / 1024).toFixed(1)} KB)`);
    }
  });

  describe('Individual message sizes', function () {
    it('should measure channel_open payload size', function () {
      const payload = makeChannelOpenPayload();
      const wrapped = wrapAsP2PMessage('channel_open', payload);
      const payloadBytes = safeByteSize(payload);
      const wrappedBytes = safeByteSize(wrapped);

      sizeTable.push({ messageType: 'channel_open', payloadBytes, wrappedBytes });

      expect(payloadBytes).to.be.greaterThan(0);
      expect(wrappedBytes).to.be.greaterThan(payloadBytes);
    });

    it('should measure channel_ack payload size', function () {
      const payload = makeChannelAckPayload();
      const wrapped = wrapAsP2PMessage('channel_ack', payload);
      const payloadBytes = safeByteSize(payload);
      const wrappedBytes = safeByteSize(wrapped);

      sizeTable.push({ messageType: 'channel_ack', payloadBytes, wrappedBytes });

      expect(payloadBytes).to.be.greaterThan(0);
    });

    it('should measure bisection_move payload size', function () {
      const payload = makeBisectionMovePayload(36); // mid-depth
      const wrapped = wrapAsP2PMessage('bisection_move', payload);
      const payloadBytes = safeByteSize(payload);
      const wrappedBytes = safeByteSize(wrapped);

      sizeTable.push({ messageType: 'bisection_move', payloadBytes, wrappedBytes });

      expect(payloadBytes).to.be.greaterThan(0);
    });

    it('should measure proof_request payload size', function () {
      const payload = makeProofRequestPayload();
      const wrapped = wrapAsP2PMessage('proof_request', payload);
      const payloadBytes = safeByteSize(payload);
      const wrappedBytes = safeByteSize(wrapped);

      sizeTable.push({ messageType: 'proof_request', payloadBytes, wrappedBytes });

      expect(payloadBytes).to.be.greaterThan(0);
    });

    it('should measure proof_submit payload size', function () {
      const payload = makeProofSubmitPayload();
      const wrapped = wrapAsP2PMessage('proof_submit', payload);
      const payloadBytes = safeByteSize(payload);
      const wrappedBytes = safeByteSize(wrapped);

      sizeTable.push({ messageType: 'proof_submit', payloadBytes, wrappedBytes });

      // Proof is the largest payload
      expect(payloadBytes).to.be.greaterThan(200);
    });

    it('should measure channel_close payload size', function () {
      const payload = makeChannelClosePayload();
      const wrapped = wrapAsP2PMessage('channel_close', payload);
      const payloadBytes = safeByteSize(payload);
      const wrappedBytes = safeByteSize(wrapped);

      sizeTable.push({ messageType: 'channel_close', payloadBytes, wrappedBytes });

      expect(payloadBytes).to.be.greaterThan(0);
    });
  });

  describe('Bisection depth scaling', function () {
    it('should measure bisection message size at various depths', function () {
      const depths = [1, 10, 20, 36, 50, 73];
      const sizes: Array<{ depth: number; bytes: number }> = [];

      for (const depth of depths) {
        const payload = makeBisectionMovePayload(depth);
        const wrapped = wrapAsP2PMessage('bisection_move', payload);
        const bytes = safeByteSize(wrapped);
        sizes.push({ depth, bytes });
      }

      console.log('\n  Bisection message size by depth:');
      for (const { depth, bytes } of sizes) {
        console.log(`    depth ${depth.toString().padStart(2)}: ${bytes} bytes`);
      }

      // Message size should be roughly constant regardless of depth
      // (depth/position are just numbers, not arrays)
      const minSize = Math.min(...sizes.map(s => s.bytes));
      const maxSize = Math.max(...sizes.map(s => s.bytes));
      expect(maxSize - minSize).to.be.lessThan(100);
    });
  });

  describe('Full dispute bandwidth estimate', function () {
    it('should calculate total off-chain bandwidth for a complete dispute', function () {
      // A complete dispute lifecycle uses these messages:
      // 1x channel_open + 1x channel_ack
      // 73 rounds * 2 bisection_moves (attack + defend) = 146 moves
      // 1x proof_request + 1x proof_submit
      // 1x channel_close

      const channelOpen = safeByteSize(wrapAsP2PMessage('channel_open', makeChannelOpenPayload()));
      const channelAck = safeByteSize(wrapAsP2PMessage('channel_ack', makeChannelAckPayload()));
      const bisectionMove = safeByteSize(wrapAsP2PMessage('bisection_move', makeBisectionMovePayload(36)));
      const proofRequest = safeByteSize(wrapAsP2PMessage('proof_request', makeProofRequestPayload()));
      const proofSubmit = safeByteSize(wrapAsP2PMessage('proof_submit', makeProofSubmitPayload()));
      const channelClose = safeByteSize(wrapAsP2PMessage('channel_close', makeChannelClosePayload()));

      const totalBytes =
        channelOpen +
        channelAck +
        146 * bisectionMove +
        proofRequest +
        proofSubmit +
        channelClose;

      console.log('\n  Full dispute bandwidth breakdown:');
      console.log(`    channel_open:     ${channelOpen} bytes  x1`);
      console.log(`    channel_ack:      ${channelAck} bytes  x1`);
      console.log(`    bisection_move:   ${bisectionMove} bytes  x146`);
      console.log(`    proof_request:    ${proofRequest} bytes  x1`);
      console.log(`    proof_submit:     ${proofSubmit} bytes  x1`);
      console.log(`    channel_close:    ${channelClose} bytes  x1`);
      console.log(`    ─────────────────────────────────────`);
      console.log(`    Total:            ${totalBytes.toLocaleString()} bytes (${(totalBytes / 1024).toFixed(1)} KB)`);

      // Total should be well under 1 MB for a full dispute
      expect(totalBytes).to.be.lessThan(1_000_000);
      // But should be non-trivial
      expect(totalBytes).to.be.greaterThan(10_000);
    });
  });
});
