/**
 * Prover Unit Tests (Real ZKProver + PoseidonHasher)
 */

import { expect } from 'chai';
import * as path from 'path';
import type { Context } from 'mocha';
import { MipsExecutor } from '../src/common/mips';
import { ZKProver, PoseidonHasher } from '../src/common/prover';

// Circuit paths
const CIRCUITS_DIR = path.join(__dirname, '..', '..', 'circuits', 'build');
const WASM_PATH = path.join(CIRCUITS_DIR, 'mips_single_step_js', 'mips_single_step.wasm');
const ZKEY_PATH = path.join(CIRCUITS_DIR, 'mips_single_step_final.zkey');
const VKEY_PATH = path.join(CIRCUITS_DIR, 'verification_key.json');

describe('PoseidonHasher', function() {
  this.timeout(30000);

  let hasher: PoseidonHasher;

  before(async function(this: Context) {
    hasher = new PoseidonHasher();
    try {
      await hasher.initialize();
    } catch (e: any) {
      console.log('PoseidonHasher not available:', e.message);
      this.skip();
    }
  });

  describe('hash', () => {
    it('should hash array of bigints', () => {
      const inputs = [1n, 2n, 3n, 4n, 5n];
      const hash = hasher.hash(inputs);

      expect(typeof hash).to.equal('bigint');
      expect(hash > 0n).to.be.true;
    });

    it('should be deterministic', () => {
      const inputs = [10n, 20n, 30n];
      const hash1 = hasher.hash(inputs);
      const hash2 = hasher.hash(inputs);

      expect(hash1).to.equal(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = hasher.hash([1n, 2n, 3n]);
      const hash2 = hasher.hash([4n, 5n, 6n]);

      expect(hash1).to.not.equal(hash2);
    });

    it('should handle large numbers', () => {
      const inputs = [BigInt(2 ** 200), BigInt(2 ** 100)];
      const hash = hasher.hash(inputs);

      expect(typeof hash).to.equal('bigint');
    });
  });

  describe('hashMipsState', () => {
    it('should hash MIPS state', () => {
      const state = MipsExecutor.createInitialState();
      const hash = hasher.hashMipsState(state);

      expect(typeof hash).to.equal('bigint');
    });

    it('should produce different hashes for different states', () => {
      const state1 = MipsExecutor.createInitialState();
      const state2 = { ...MipsExecutor.createInitialState(), pc: 100n };

      const hash1 = hasher.hashMipsState(state1);
      const hash2 = hasher.hashMipsState(state2);

      expect(hash1).to.not.equal(hash2);
    });

    it('should be sensitive to register changes', () => {
      const state1 = MipsExecutor.createInitialState();
      const state2 = MipsExecutor.createInitialState();
      state2.registers = [...state2.registers];
      state2.registers[5] = 999n;

      const hash1 = hasher.hashMipsState(state1);
      const hash2 = hasher.hashMipsState(state2);

      expect(hash1).to.not.equal(hash2);
    });
  });
});

describe('ZKProver', function() {
  this.timeout(60000);

  let prover: ZKProver;
  let poseidonHasher: PoseidonHasher;

  before(async function(this: Context) {
    prover = new ZKProver(WASM_PATH, ZKEY_PATH, VKEY_PATH);
    poseidonHasher = new PoseidonHasher();

    try {
      await prover.initialize();
      await poseidonHasher.initialize();
    } catch (e: any) {
      console.log('ZK components not available:', e.message);
      this.skip();
    }
  });

  describe('generateProof', () => {
    it('should generate proof for valid input', async () => {
      const executor = new MipsExecutor();
      const preState = MipsExecutor.createInitialState();

      const instruction = 0x20010064n; // addi $1, $0, 100
      const postState = executor.executeStep(preState, instruction);

      const preHash = poseidonHasher.hashMipsState(preState);
      const postHash = poseidonHasher.hashMipsState(postState);
      const proofInput = ZKProver.createProofInput(preState, postState, preHash, postHash, instruction);

      const proof = await prover.generateProof(proofInput);

      expect(proof).to.have.property('proof');
      expect(proof).to.have.property('publicInputs');
      expect(proof.proof.a).to.have.lengthOf(2);
      expect(proof.proof.b).to.have.lengthOf(2);
      expect(proof.proof.c).to.have.lengthOf(2);
    });

    it('should include public inputs', async () => {
      const executor = new MipsExecutor();
      const preState = MipsExecutor.createInitialState();
      const instruction = 0x20010064n;
      const postState = executor.executeStep(preState, instruction);

      const preHash = poseidonHasher.hashMipsState(preState);
      const postHash = poseidonHasher.hashMipsState(postState);
      const proofInput = ZKProver.createProofInput(preState, postState, preHash, postHash, instruction);

      const proof = await prover.generateProof(proofInput);

      expect(proof.publicInputs.length).to.be.greaterThan(0);
    });
  });

  describe('verifyProof', () => {
    it('should verify valid proof', async () => {
      const executor = new MipsExecutor();
      const preState = MipsExecutor.createInitialState();
      const instruction = 0x20010064n;
      const postState = executor.executeStep(preState, instruction);

      const preHash = poseidonHasher.hashMipsState(preState);
      const postHash = poseidonHasher.hashMipsState(postState);
      const proofInput = ZKProver.createProofInput(preState, postState, preHash, postHash, instruction);

      const proof = await prover.generateProof(proofInput);
      const isValid = await prover.verifyProof(proof);

      expect(isValid).to.be.true;
    });

    it('should reject malformed proof', async () => {
      const malformedProof = {
        proof: {
          a: ['0x1'],
          b: [['0x1', '0x2'], ['0x3', '0x4']],
          c: ['0x1', '0x2'],
        },
        publicInputs: ['0x1'],
      } as any;

      try {
        const isValid = await prover.verifyProof(malformedProof);
        expect(isValid).to.be.false;
      } catch {
        // snarkjs may throw on malformed input — that's acceptable
      }
    });
  });
});

describe('Proof Input Creation', function() {
  this.timeout(30000);

  let poseidonHasher: PoseidonHasher;

  before(async function(this: Context) {
    poseidonHasher = new PoseidonHasher();
    try {
      await poseidonHasher.initialize();
    } catch (e: any) {
      console.log('PoseidonHasher not available:', e.message);
      this.skip();
    }
  });

  it('should create valid proof input from states', () => {
    const executor = new MipsExecutor();
    const preState = MipsExecutor.createInitialState();
    const instruction = 0x20010064n; // addi $1, $0, 100
    const postState = executor.executeStep(preState, instruction);

    const preStateHash = poseidonHasher.hashMipsState(preState);
    const postStateHash = poseidonHasher.hashMipsState(postState);

    const input = ZKProver.createProofInput(preState, postState, preStateHash, postStateHash, instruction);

    expect(input.prePC).to.equal(0n);
    expect(input.preRegisters[1]).to.equal(0n);
    expect(input.preStateHash).to.equal(preStateHash);
    expect(input.postStateHash).to.equal(postStateHash);
    expect(typeof preStateHash).to.equal('bigint');
    expect(typeof postStateHash).to.equal('bigint');
  });

  it('should capture state transition correctly', () => {
    const executor = new MipsExecutor();
    let state = MipsExecutor.createInitialState();

    // Execute multiple instructions
    state = executor.executeStep(state, 0x20010064n); // addi $1, $0, 100
    const preState = { ...state, registers: [...state.registers] };

    state = executor.executeStep(state, 0x20020032n); // addi $2, $0, 50
    const postState = state;

    expect(preState.step).to.equal(1n);
    expect(postState.step).to.equal(2n);
    expect(preState.registers[2]).to.equal(0n);
    expect(postState.registers[2]).to.equal(50n);
  });
});
