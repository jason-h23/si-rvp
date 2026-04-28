/**
 * Hash Utilities Unit Tests
 */

import { expect } from 'chai';
import { ethers } from 'ethers';
import {
  hashMipsStateKeccak,
  hashStateSimple,
  hashClaim,
  hashChannelMessage,
  computeMerkleRoot,
  generateMerkleProof,
  verifyMerkleProof,
} from '../src/common/hash';
import { MipsState, StateHashInput } from '../src/common/types';

describe('Hash Utilities', () => {
  // ============================================
  // hashMipsStateKeccak Tests
  // ============================================
  describe('hashMipsStateKeccak', () => {
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

    it('should generate a valid 32-byte hash', () => {
      const state = createTestState();
      const hash = hashMipsStateKeccak(state);

      expect(hash).to.match(/^0x[a-f0-9]{64}$/);
    });

    it('should generate consistent hashes for same state', () => {
      const state = createTestState();
      const hash1 = hashMipsStateKeccak(state);
      const hash2 = hashMipsStateKeccak(state);

      expect(hash1).to.equal(hash2);
    });

    it('should generate different hashes for different states', () => {
      const state1 = createTestState();
      const state2 = { ...createTestState(), pc: 100n };

      const hash1 = hashMipsStateKeccak(state1);
      const hash2 = hashMipsStateKeccak(state2);

      expect(hash1).to.not.equal(hash2);
    });

    it('should be sensitive to register changes', () => {
      const state1 = createTestState();
      const state2 = createTestState();
      state2.registers = [...state2.registers];
      state2.registers[5] = 999n;

      const hash1 = hashMipsStateKeccak(state1);
      const hash2 = hashMipsStateKeccak(state2);

      expect(hash1).to.not.equal(hash2);
    });

    it('should be sensitive to step changes', () => {
      const state1 = createTestState();
      const state2 = { ...createTestState(), step: 100n };

      const hash1 = hashMipsStateKeccak(state1);
      const hash2 = hashMipsStateKeccak(state2);

      expect(hash1).to.not.equal(hash2);
    });

    it('should be sensitive to exitCode changes', () => {
      const state1 = createTestState();
      const state2 = { ...createTestState(), exitCode: 1 };

      const hash1 = hashMipsStateKeccak(state1);
      const hash2 = hashMipsStateKeccak(state2);

      expect(hash1).to.not.equal(hash2);
    });
  });

  // ============================================
  // hashStateSimple Tests
  // ============================================
  describe('hashStateSimple', () => {
    it('should generate a valid hash for simple input', () => {
      const input: StateHashInput = {
        pc: 0n,
        nextPC: 4n,
        lo: 0n,
        hi: 0n,
        registers: Array(32).fill(0n),
        memRoot: ethers.ZeroHash,
        step: 0n,
      };

      const hash = hashStateSimple(input);
      expect(hash).to.match(/^0x[a-f0-9]{64}$/);
    });

    it('should be consistent', () => {
      const input: StateHashInput = {
        pc: 100n,
        nextPC: 104n,
        lo: 50n,
        hi: 25n,
        registers: Array(32).fill(0n),
        memRoot: ethers.ZeroHash,
        step: 10n,
      };

      const hash1 = hashStateSimple(input);
      const hash2 = hashStateSimple(input);

      expect(hash1).to.equal(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      const input1: StateHashInput = {
        pc: 0n,
        nextPC: 4n,
        lo: 0n,
        hi: 0n,
        registers: Array(32).fill(0n),
        memRoot: ethers.ZeroHash,
        step: 0n,
      };

      const input2: StateHashInput = {
        pc: 100n,
        nextPC: 104n,
        lo: 0n,
        hi: 0n,
        registers: Array(32).fill(0n),
        memRoot: ethers.ZeroHash,
        step: 0n,
      };

      const hash1 = hashStateSimple(input1);
      const hash2 = hashStateSimple(input2);

      expect(hash1).to.not.equal(hash2);
    });
  });

  // ============================================
  // hashClaim Tests
  // ============================================
  describe('hashClaim', () => {
    it('should generate a valid claim hash', () => {
      const preStateHash = '0x' + '1'.repeat(64);
      const postStateHash = '0x' + '2'.repeat(64);
      const step = 100n;

      const hash = hashClaim(preStateHash, postStateHash, step);
      expect(hash).to.match(/^0x[a-f0-9]{64}$/);
    });

    it('should be consistent', () => {
      const preStateHash = '0x' + 'a'.repeat(64);
      const postStateHash = '0x' + 'b'.repeat(64);
      const step = 50n;

      const hash1 = hashClaim(preStateHash, postStateHash, step);
      const hash2 = hashClaim(preStateHash, postStateHash, step);

      expect(hash1).to.equal(hash2);
    });

    it('should be sensitive to preStateHash', () => {
      const postStateHash = '0x' + '2'.repeat(64);
      const step = 100n;

      const hash1 = hashClaim('0x' + '1'.repeat(64), postStateHash, step);
      const hash2 = hashClaim('0x' + '3'.repeat(64), postStateHash, step);

      expect(hash1).to.not.equal(hash2);
    });

    it('should be sensitive to postStateHash', () => {
      const preStateHash = '0x' + '1'.repeat(64);
      const step = 100n;

      const hash1 = hashClaim(preStateHash, '0x' + '2'.repeat(64), step);
      const hash2 = hashClaim(preStateHash, '0x' + '3'.repeat(64), step);

      expect(hash1).to.not.equal(hash2);
    });

    it('should be sensitive to step', () => {
      const preStateHash = '0x' + '1'.repeat(64);
      const postStateHash = '0x' + '2'.repeat(64);

      const hash1 = hashClaim(preStateHash, postStateHash, 100n);
      const hash2 = hashClaim(preStateHash, postStateHash, 200n);

      expect(hash1).to.not.equal(hash2);
    });
  });

  // ============================================
  // hashChannelMessage Tests
  // ============================================
  describe('hashChannelMessage', () => {
    it('should generate a valid message hash', () => {
      const channelId = '0x' + '1'.repeat(64);
      const sequence = 1;
      const type = 'attack';
      const payloadHash = '0x' + '2'.repeat(64);
      const timestamp = Date.now();

      const hash = hashChannelMessage(channelId, sequence, type, payloadHash, timestamp);
      expect(hash).to.match(/^0x[a-f0-9]{64}$/);
    });

    it('should be consistent', () => {
      const channelId = '0x' + '1'.repeat(64);
      const sequence = 5;
      const type = 'defend';
      const payloadHash = '0x' + '2'.repeat(64);
      const timestamp = 1234567890;

      const hash1 = hashChannelMessage(channelId, sequence, type, payloadHash, timestamp);
      const hash2 = hashChannelMessage(channelId, sequence, type, payloadHash, timestamp);

      expect(hash1).to.equal(hash2);
    });

    it('should be sensitive to sequence changes', () => {
      const channelId = '0x' + '1'.repeat(64);
      const type = 'attack';
      const payloadHash = '0x' + '2'.repeat(64);
      const timestamp = Date.now();

      const hash1 = hashChannelMessage(channelId, 1, type, payloadHash, timestamp);
      const hash2 = hashChannelMessage(channelId, 2, type, payloadHash, timestamp);

      expect(hash1).to.not.equal(hash2);
    });

    it('should be sensitive to type changes', () => {
      const channelId = '0x' + '1'.repeat(64);
      const sequence = 1;
      const payloadHash = '0x' + '2'.repeat(64);
      const timestamp = Date.now();

      const hash1 = hashChannelMessage(channelId, sequence, 'attack', payloadHash, timestamp);
      const hash2 = hashChannelMessage(channelId, sequence, 'defend', payloadHash, timestamp);

      expect(hash1).to.not.equal(hash2);
    });
  });

  // ============================================
  // Merkle Tree Tests
  // ============================================
  describe('Merkle Tree', () => {
    describe('computeMerkleRoot', () => {
      it('should return ZeroHash for empty leaves', () => {
        const root = computeMerkleRoot([]);
        expect(root).to.equal(ethers.ZeroHash);
      });

      it('should return the leaf itself for single leaf', () => {
        const leaf = ethers.keccak256(ethers.toUtf8Bytes('test'));
        const root = computeMerkleRoot([leaf]);
        expect(root).to.equal(leaf);
      });

      it('should compute root for two leaves', () => {
        const leaf1 = ethers.keccak256(ethers.toUtf8Bytes('leaf1'));
        const leaf2 = ethers.keccak256(ethers.toUtf8Bytes('leaf2'));

        const root = computeMerkleRoot([leaf1, leaf2]);

        // Manually compute expected root
        const expectedRoot = ethers.keccak256(
          ethers.solidityPacked(['bytes32', 'bytes32'], [leaf1, leaf2])
        );

        expect(root).to.equal(expectedRoot);
      });

      it('should compute root for four leaves', () => {
        const leaves = [
          ethers.keccak256(ethers.toUtf8Bytes('leaf1')),
          ethers.keccak256(ethers.toUtf8Bytes('leaf2')),
          ethers.keccak256(ethers.toUtf8Bytes('leaf3')),
          ethers.keccak256(ethers.toUtf8Bytes('leaf4')),
        ];

        const root = computeMerkleRoot(leaves);
        expect(root).to.match(/^0x[a-f0-9]{64}$/);
      });

      it('should handle odd number of leaves by duplicating last leaf', () => {
        const leaves = [
          ethers.keccak256(ethers.toUtf8Bytes('leaf1')),
          ethers.keccak256(ethers.toUtf8Bytes('leaf2')),
          ethers.keccak256(ethers.toUtf8Bytes('leaf3')),
        ];

        const root = computeMerkleRoot(leaves);
        expect(root).to.match(/^0x[a-f0-9]{64}$/);
      });

      it('should be consistent', () => {
        const leaves = [
          ethers.keccak256(ethers.toUtf8Bytes('a')),
          ethers.keccak256(ethers.toUtf8Bytes('b')),
          ethers.keccak256(ethers.toUtf8Bytes('c')),
          ethers.keccak256(ethers.toUtf8Bytes('d')),
        ];

        const root1 = computeMerkleRoot(leaves);
        const root2 = computeMerkleRoot(leaves);

        expect(root1).to.equal(root2);
      });
    });

    describe('generateMerkleProof', () => {
      it('should generate valid proof for first leaf', () => {
        const leaves = [
          ethers.keccak256(ethers.toUtf8Bytes('leaf1')),
          ethers.keccak256(ethers.toUtf8Bytes('leaf2')),
          ethers.keccak256(ethers.toUtf8Bytes('leaf3')),
          ethers.keccak256(ethers.toUtf8Bytes('leaf4')),
        ];

        const { proof, siblings } = generateMerkleProof(leaves, 0);

        expect(proof).to.have.lengthOf(2); // log2(4) = 2
        expect(siblings).to.have.lengthOf(2);
      });

      it('should generate valid proof for last leaf', () => {
        const leaves = [
          ethers.keccak256(ethers.toUtf8Bytes('leaf1')),
          ethers.keccak256(ethers.toUtf8Bytes('leaf2')),
          ethers.keccak256(ethers.toUtf8Bytes('leaf3')),
          ethers.keccak256(ethers.toUtf8Bytes('leaf4')),
        ];

        const { proof, siblings } = generateMerkleProof(leaves, 3);

        expect(proof).to.have.lengthOf(2);
        expect(siblings).to.have.lengthOf(2);
      });

      it('should generate proofs with valid hashes', () => {
        const leaves = [
          ethers.keccak256(ethers.toUtf8Bytes('a')),
          ethers.keccak256(ethers.toUtf8Bytes('b')),
        ];

        const { proof } = generateMerkleProof(leaves, 0);

        for (const p of proof) {
          expect(p).to.match(/^0x[a-f0-9]{64}$/);
        }
      });
    });

    describe('verifyMerkleProof', () => {
      it('should verify valid proof for leaf', () => {
        const leaves = [
          ethers.keccak256(ethers.toUtf8Bytes('leaf1')),
          ethers.keccak256(ethers.toUtf8Bytes('leaf2')),
          ethers.keccak256(ethers.toUtf8Bytes('leaf3')),
          ethers.keccak256(ethers.toUtf8Bytes('leaf4')),
        ];

        const root = computeMerkleRoot(leaves);

        for (let i = 0; i < leaves.length; i++) {
          const { proof, siblings } = generateMerkleProof(leaves, i);
          const isValid = verifyMerkleProof(leaves[i], proof, siblings, root);
          expect(isValid).to.be.true;
        }
      });

      it('should reject invalid proof (wrong leaf)', () => {
        const leaves = [
          ethers.keccak256(ethers.toUtf8Bytes('leaf1')),
          ethers.keccak256(ethers.toUtf8Bytes('leaf2')),
          ethers.keccak256(ethers.toUtf8Bytes('leaf3')),
          ethers.keccak256(ethers.toUtf8Bytes('leaf4')),
        ];

        const root = computeMerkleRoot(leaves);
        const { proof, siblings } = generateMerkleProof(leaves, 0);

        // Try to verify with wrong leaf
        const wrongLeaf = ethers.keccak256(ethers.toUtf8Bytes('wrong'));
        const isValid = verifyMerkleProof(wrongLeaf, proof, siblings, root);

        expect(isValid).to.be.false;
      });

      it('should reject invalid proof (wrong root)', () => {
        const leaves = [
          ethers.keccak256(ethers.toUtf8Bytes('leaf1')),
          ethers.keccak256(ethers.toUtf8Bytes('leaf2')),
        ];

        const { proof, siblings } = generateMerkleProof(leaves, 0);
        const wrongRoot = ethers.keccak256(ethers.toUtf8Bytes('wrong'));

        const isValid = verifyMerkleProof(leaves[0], proof, siblings, wrongRoot);
        expect(isValid).to.be.false;
      });

      it('should work for single leaf', () => {
        const leaf = ethers.keccak256(ethers.toUtf8Bytes('single'));
        const root = computeMerkleRoot([leaf]);
        const { proof, siblings } = generateMerkleProof([leaf], 0);

        const isValid = verifyMerkleProof(leaf, proof, siblings, root);
        expect(isValid).to.be.true;
      });

      it('should work for 8 leaves', () => {
        const leaves = Array(8)
          .fill(0)
          .map((_, i) => ethers.keccak256(ethers.toUtf8Bytes(`leaf${i}`)));

        const root = computeMerkleRoot(leaves);

        for (let i = 0; i < leaves.length; i++) {
          const { proof, siblings } = generateMerkleProof(leaves, i);
          const isValid = verifyMerkleProof(leaves[i], proof, siblings, root);
          expect(isValid).to.be.true;
        }
      });
    });
  });
});
