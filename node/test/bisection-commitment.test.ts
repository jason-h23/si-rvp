/**
 * Bisection Commitment Hash Unification Tests
 *
 * Verifies the off-chain bisection commitment matches the canonical
 * on-chain formula in DisputeManager.sol:252-254:
 *
 *   keccak256(abi.encodePacked(publicInputs[0], publicInputs[1], disputedStep))
 *
 * where publicInputs[0..1] are Poseidon-hashed pre/post MIPS states
 * (uint256 BN254 field elements emitted by the ZK circuit).
 */

import { expect } from 'chai';
import { ethers } from 'ethers';
import { hashBisectionCommitment, hashMipsStateKeccak } from '../src/common/hash';
import { PoseidonHasher } from '../src/common/prover';
import { MipsState } from '../src/common/types';

describe('Bisection Commitment (Poseidon-aligned)', () => {
  const makeState = (overrides: Partial<MipsState> = {}): MipsState => ({
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
    ...overrides,
  });

  let poseidon: PoseidonHasher;

  before(async () => {
    poseidon = new PoseidonHasher();
    await poseidon.initialize();
  });

  it('matches the canonical DisputeManager.sol formula (pre, post, step)', () => {
    const preState = makeState({ pc: 100n, step: 50n });
    const postState = makeState({ pc: 104n, step: 51n });
    const disputedStep = 50n;

    const preHash = poseidon.hashMipsState(preState);
    const postHash = poseidon.hashMipsState(postState);
    const preHashHex = '0x' + preHash.toString(16).padStart(64, '0');
    const postHashHex = '0x' + postHash.toString(16).padStart(64, '0');

    const actual = hashBisectionCommitment(preHashHex, postHashHex, disputedStep);

    // Replicate the exact on-chain formula from DisputeManager.sol:252-254
    const expected = ethers.keccak256(
      ethers.solidityPacked(
        ['uint256', 'uint256', 'uint256'],
        [preHash, postHash, disputedStep]
      )
    );

    expect(actual).to.equal(expected);
  });

  it('does NOT match the old broken formula (step, keccak(pre), keccak(post))', () => {
    const preState = makeState({ pc: 100n, step: 50n });
    const postState = makeState({ pc: 104n, step: 51n });
    const disputedStep = 50n;

    const preHash = poseidon.hashMipsState(preState);
    const postHash = poseidon.hashMipsState(postState);
    const preHashHex = '0x' + preHash.toString(16).padStart(64, '0');
    const postHashHex = '0x' + postHash.toString(16).padStart(64, '0');

    const correct = hashBisectionCommitment(preHashHex, postHashHex, disputedStep);

    // The previously-broken formula: keccak-of-state inner hashes,
    // (step, pre, post) order.
    const oldBroken = ethers.keccak256(
      ethers.solidityPacked(
        ['uint256', 'bytes32', 'bytes32'],
        [disputedStep, hashMipsStateKeccak(preState), hashMipsStateKeccak(postState)]
      )
    );

    expect(correct).to.not.equal(oldBroken);
  });

  it('is sensitive to disputedStep', () => {
    const preState = makeState({ pc: 100n });
    const postState = makeState({ pc: 104n });

    const preHash = poseidon.hashMipsState(preState);
    const postHash = poseidon.hashMipsState(postState);
    const preHex = '0x' + preHash.toString(16).padStart(64, '0');
    const postHex = '0x' + postHash.toString(16).padStart(64, '0');

    const a = hashBisectionCommitment(preHex, postHex, 10n);
    const b = hashBisectionCommitment(preHex, postHex, 11n);
    expect(a).to.not.equal(b);
  });

  it('is sensitive to swapped pre/post order', () => {
    const preState = makeState({ pc: 100n });
    const postState = makeState({ pc: 104n });
    const step = 7n;

    const preHash = poseidon.hashMipsState(preState);
    const postHash = poseidon.hashMipsState(postState);
    const preHex = '0x' + preHash.toString(16).padStart(64, '0');
    const postHex = '0x' + postHash.toString(16).padStart(64, '0');

    const correct = hashBisectionCommitment(preHex, postHex, step);
    const swapped = hashBisectionCommitment(postHex, preHex, step);
    expect(correct).to.not.equal(swapped);
  });
});
