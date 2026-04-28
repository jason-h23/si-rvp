/**
 * SI-RVP - State Hash Utilities
 *
 * Keccak256: Cannon compatible (on-chain)
 * Poseidon: For ZK circuits (circom)
 */

import { ethers } from 'ethers';
import { MipsState, StateHashInput } from './types';

// ============================================
// Keccak256-based hash (Cannon compatible)
// ============================================

/**
 * Hash MIPS state with Keccak256
 * Compatible with Cannon FPVM's outputState()
 */
export function hashMipsStateKeccak(state: MipsState): string {
  const packed = ethers.solidityPacked(
    [
      'uint64',   // pc
      'uint64',   // nextPC
      'uint64',   // lo
      'uint64',   // hi
      'uint64[32]', // registers
      'bytes32',  // memoryRoot
      'uint64',   // step
      'uint8',    // exitCode
      'bool',     // exited
    ],
    [
      state.pc,
      state.nextPC,
      state.lo,
      state.hi,
      state.registers,
      state.memoryRoot,
      state.step,
      state.exitCode,
      state.exited,
    ]
  );

  return ethers.keccak256(packed);
}

/**
 * Simple state hash (core fields only)
 */
export function hashStateSimple(input: StateHashInput): string {
  const packed = ethers.solidityPacked(
    ['uint64', 'uint64', 'uint64', 'uint64', 'bytes32', 'uint64'],
    [input.pc, input.nextPC, input.lo, input.hi, input.memRoot, input.step]
  );

  return ethers.keccak256(packed);
}

/**
 * Bisection claim hash
 */
export function hashClaim(
  preStateHash: string,
  postStateHash: string,
  step: bigint
): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ['bytes32', 'bytes32', 'uint64'],
      [preStateHash, postStateHash, step]
    )
  );
}

/**
 * Bisection commitment matching DisputeManager.sol:252-254.
 * Order: (preStateHash, postStateHash, disputedStep).
 * Inner hashes MUST be Poseidon outputs (uint256), not keccak256.
 */
export function hashBisectionCommitment(
  preStateHash: string,   // bytes32 hex of Poseidon output
  postStateHash: string,
  disputedStep: bigint
): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ['uint256', 'uint256', 'uint256'],
      [preStateHash, postStateHash, disputedStep]
    )
  );
}

/**
 * Channel message hash (for signing)
 */
export function hashChannelMessage(
  channelId: string,
  sequence: number,
  type: string,
  payloadHash: string,
  timestamp: number
): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ['bytes32', 'uint256', 'string', 'bytes32', 'uint256'],
      [channelId, sequence, type, payloadHash, timestamp]
    )
  );
}

// ============================================
// Merkle tree utilities
// ============================================

/**
 * Compute Merkle root (Keccak256)
 */
export function computeMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) {
    return ethers.ZeroHash;
  }

  let layer = [...leaves];

  while (layer.length > 1) {
    const nextLayer: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] || left; // duplicate if odd
      nextLayer.push(
        ethers.keccak256(ethers.solidityPacked(['bytes32', 'bytes32'], [left, right]))
      );
    }
    layer = nextLayer;
  }

  return layer[0];
}

/**
 * Generate Merkle proof
 */
export function generateMerkleProof(
  leaves: string[],
  index: number
): { proof: string[]; siblings: boolean[] } {
  const proof: string[] = [];
  const siblings: boolean[] = []; // true = right sibling

  let layer = [...leaves];
  let idx = index;

  while (layer.length > 1) {
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    const sibling = layer[siblingIdx] || layer[idx];

    proof.push(sibling);
    siblings.push(idx % 2 === 0);

    const nextLayer: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] || left;
      nextLayer.push(
        ethers.keccak256(ethers.solidityPacked(['bytes32', 'bytes32'], [left, right]))
      );
    }

    layer = nextLayer;
    idx = Math.floor(idx / 2);
  }

  return { proof, siblings };
}

/**
 * Verify Merkle proof
 */
export function verifyMerkleProof(
  leaf: string,
  proof: string[],
  siblings: boolean[],
  root: string
): boolean {
  let current = leaf;

  for (let i = 0; i < proof.length; i++) {
    const [left, right] = siblings[i]
      ? [current, proof[i]]
      : [proof[i], current];

    current = ethers.keccak256(
      ethers.solidityPacked(['bytes32', 'bytes32'], [left, right])
    );
  }

  return current === root;
}
