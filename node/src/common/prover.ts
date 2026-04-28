/**
 * SI-RVP - ZK Proof Generator
 *
 * Groth16 proof generation based on snarkjs
 */

// @ts-ignore - snarkjs doesn't have type declarations
import * as snarkjs from 'snarkjs';
import * as fs from 'fs';
import * as path from 'path';
import { MipsState, ZKProof } from './types';

// ============================================
// Circuit Paths
// ============================================
const CIRCUITS_BUILD_DIR = path.join(__dirname, '..', '..', '..', '..', 'circuits', 'build');
const WASM_PATH = path.join(CIRCUITS_BUILD_DIR, 'mips_single_step_js', 'mips_single_step.wasm');
const ZKEY_PATH = path.join(CIRCUITS_BUILD_DIR, 'mips_single_step_final.zkey');
const VKEY_PATH = path.join(CIRCUITS_BUILD_DIR, 'verification_key.json');

// ============================================
// Proof Input Interface
// ============================================
export interface ProofInput {
  // Public inputs
  preStateHash: bigint;
  postStateHash: bigint;

  // Private inputs: Pre-state
  prePC: bigint;
  preNextPC: bigint;
  preRegisters: bigint[];
  preHi: bigint;
  preLo: bigint;
  preMemoryRoot: bigint;
  preStep: bigint;

  // Private inputs: Instruction
  instruction: bigint;

  // Private inputs: Memory access
  memAddress: bigint;
  memValue: bigint;
  memProof: bigint[];

  // Private inputs: Post-state
  postPC: bigint;
  postNextPC: bigint;
  postRegisters: bigint[];
  postHi: bigint;
  postLo: bigint;
  postMemoryRoot: bigint;
  postStep: bigint;
}

// ============================================
// Verification Key Interface
// ============================================
interface VerificationKey {
  protocol: string;
  curve: string;
  nPublic: number;
  vk_alpha_1: string[];
  vk_beta_2: string[][];
  vk_gamma_2: string[][];
  vk_delta_2: string[][];
  IC: string[][];
}

// ============================================
// ZK Prover Class
// ============================================
export class ZKProver {
  private wasmPath: string;
  private zkeyPath: string;
  private vkeyPath: string;
  private vkey: VerificationKey | null = null;

  constructor(
    wasmPath: string = WASM_PATH,
    zkeyPath: string = ZKEY_PATH,
    vkeyPath: string = VKEY_PATH
  ) {
    this.wasmPath = wasmPath;
    this.zkeyPath = zkeyPath;
    this.vkeyPath = vkeyPath;
  }

  /**
   * Initialize prover (load verification key)
   */
  async initialize(): Promise<void> {
    if (!fs.existsSync(this.wasmPath)) {
      throw new Error(`WASM file not found: ${this.wasmPath}`);
    }
    if (!fs.existsSync(this.zkeyPath)) {
      throw new Error(`zkey file not found: ${this.zkeyPath}`);
    }
    if (!fs.existsSync(this.vkeyPath)) {
      throw new Error(`Verification key not found: ${this.vkeyPath}`);
    }

    this.vkey = JSON.parse(fs.readFileSync(this.vkeyPath, 'utf-8'));
    console.log('[Prover] Initialized with verification key');
  }

  /**
   * Generate proof for MIPS single step transition
   */
  async generateProof(input: ProofInput): Promise<ZKProof> {
    console.log('[Prover] Generating proof for step transition...');
    const startTime = Date.now();

    // Prepare circuit input
    const circuitInput = {
      preStateHash: input.preStateHash.toString(),
      postStateHash: input.postStateHash.toString(),
      prePC: input.prePC.toString(),
      preNextPC: input.preNextPC.toString(),
      preRegisters: input.preRegisters.map((r) => r.toString()),
      preHi: input.preHi.toString(),
      preLo: input.preLo.toString(),
      preMemoryRoot: input.preMemoryRoot.toString(),
      preStep: input.preStep.toString(),
      instruction: input.instruction.toString(),
      memAddress: input.memAddress.toString(),
      memValue: input.memValue.toString(),
      memProof: input.memProof.map((p) => p.toString()),
      postPC: input.postPC.toString(),
      postNextPC: input.postNextPC.toString(),
      postRegisters: input.postRegisters.map((r) => r.toString()),
      postHi: input.postHi.toString(),
      postLo: input.postLo.toString(),
      postMemoryRoot: input.postMemoryRoot.toString(),
      postStep: input.postStep.toString(),
    };

    // Generate proof
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInput,
      this.wasmPath,
      this.zkeyPath
    );

    const elapsed = Date.now() - startTime;
    console.log(`[Prover] Proof generated in ${elapsed}ms`);

    // Format proof for contract
    return {
      proof: {
        a: [proof.pi_a[0], proof.pi_a[1]],
        b: [
          [proof.pi_b[0][1], proof.pi_b[0][0]], // Note: snarkjs b is transposed
          [proof.pi_b[1][1], proof.pi_b[1][0]],
        ],
        c: [proof.pi_c[0], proof.pi_c[1]],
      },
      publicInputs: publicSignals,
    };
  }

  /**
   * Verify proof locally
   */
  async verifyProof(zkProof: ZKProof): Promise<boolean> {
    if (!this.vkey) {
      throw new Error('Prover not initialized');
    }

    // Convert proof back to snarkjs format
    const proof = {
      pi_a: [zkProof.proof.a[0], zkProof.proof.a[1], '1'],
      pi_b: [
        [zkProof.proof.b[0][1], zkProof.proof.b[0][0]],
        [zkProof.proof.b[1][1], zkProof.proof.b[1][0]],
        ['1', '0'],
      ],
      pi_c: [zkProof.proof.c[0], zkProof.proof.c[1], '1'],
      protocol: 'groth16',
      curve: 'bn128',
    };

    return await snarkjs.groth16.verify(this.vkey, zkProof.publicInputs, proof);
  }

  /**
   * Create proof input from MIPS states
   */
  static createProofInput(
    preState: MipsState,
    postState: MipsState,
    preStateHash: bigint,
    postStateHash: bigint,
    instruction: bigint,
    memProof: bigint[] = new Array(20).fill(0n)
  ): ProofInput {
    return {
      preStateHash,
      postStateHash,
      prePC: preState.pc,
      preNextPC: preState.nextPC,
      preRegisters: preState.registers,
      preHi: preState.hi,
      preLo: preState.lo,
      preMemoryRoot: BigInt(preState.memoryRoot),
      preStep: preState.step,
      instruction,
      memAddress: 0n,
      memValue: 0n,
      memProof,
      postPC: postState.pc,
      postNextPC: postState.nextPC,
      postRegisters: postState.registers,
      postHi: postState.hi,
      postLo: postState.lo,
      postMemoryRoot: BigInt(postState.memoryRoot),
      postStep: postState.step,
    };
  }
}

// ============================================
// Poseidon Hasher for ZK Compatibility
// ============================================
interface PoseidonHashFunction {
  (inputs: bigint[]): Uint8Array;
  F: FieldElement;
}

interface FieldElement {
  toString(value: Uint8Array | bigint): string;
  toObject(value: Uint8Array): bigint;
  e(value: string | number | bigint): bigint;
}

export class PoseidonHasher {
  private poseidon: PoseidonHashFunction | null = null;
  private F: FieldElement | null = null;

  /**
   * Initialize Poseidon hasher
   */
  async initialize(): Promise<void> {
    // @ts-ignore
    const circomlibjs = await import('circomlibjs');
    this.poseidon = await circomlibjs.buildPoseidon();
    this.F = this.poseidon!.F;
    console.log('[PoseidonHasher] Initialized');
  }

  /**
   * Hash array of field elements
   */
  hash(inputs: bigint[]): bigint {
    if (!this.poseidon || !this.F) {
      throw new Error('PoseidonHasher not initialized');
    }

    const poseidon = this.poseidon;
    const F = this.F;
    const hash = poseidon(inputs.map((x) => F.e(x)));
    return F.toObject(hash);
  }

  /**
   * Hash MIPS state (same as circuit)
   */
  hashMipsState(state: MipsState): bigint {
    // Step 1: Hash registers (groups of 8)
    const regHashes: bigint[] = [];
    for (let g = 0; g < 4; g++) {
      const group = state.registers.slice(g * 8, (g + 1) * 8);
      regHashes.push(this.hash(group));
    }

    // Step 2: Combine register hashes
    const regHashFinal = this.hash(regHashes);

    // Step 3: Hash full state
    return this.hash([
      state.pc,
      state.nextPC,
      regHashFinal,
      state.hi,
      state.lo,
      BigInt(state.memoryRoot),
      state.step,
    ]);
  }
}
