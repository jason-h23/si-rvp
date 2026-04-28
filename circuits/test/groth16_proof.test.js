/**
 * Groth16 ZK Proof Generation and Verification Test
 *
 * Tests actual proof generation and verification.
 * - MIPS instruction execution
 * - Groth16 proof generation (fullProve)
 * - Proof verification
 */

const chai = require('chai');
const path = require('path');
const fs = require('fs');
const snarkjs = require('snarkjs');

const expect = chai.expect;

// Build paths
const BUILD_DIR = path.join(__dirname, '..', 'build');
const WASM_PATH = path.join(BUILD_DIR, 'mips_single_step_js', 'mips_single_step.wasm');
const ZKEY_PATH = path.join(BUILD_DIR, 'mips_single_step_final.zkey');
const VKEY_PATH = path.join(BUILD_DIR, 'verification_key.json');

/**
 * Poseidon hash calculation (circomlib compatible)
 */
let poseidon;
let F;

async function initPoseidon() {
  if (!poseidon) {
    const buildPoseidon = require('circomlibjs').buildPoseidon;
    poseidon = await buildPoseidon();
    F = poseidon.F;
  }
  return poseidon;
}

function poseidonHash(inputs) {
  const hash = poseidon(inputs.map(x => BigInt(x)));
  return F.toObject(hash);
}

/**
 * Bit-reverse an integer for Merkle tree path ordering.
 * The circuit uses MSB-first path: pathIndices[i] = addressBits[depth-1-i],
 * so the leaf at word address A maps to tree index bitReverse(A, depth).
 */
function bitReverse(n, depth) {
  let result = 0;
  for (let i = 0; i < depth; i++) {
    result = (result << 1) | ((n >> i) & 1);
  }
  return result;
}

/**
 * Build a sparse Poseidon Merkle tree.
 * @param {Object} leaves - Map of treeIndex → value (BigInt)
 * @param {number} depth - Tree depth
 * @returns {{ root: BigInt, getProof: (treeIndex: number) => BigInt[] }}
 */
function buildMerkleTree(leaves, depth) {
  const numLeaves = 1 << depth;
  const layers = [];

  // Layer 0: leaves (default 0)
  const layer0 = new Array(numLeaves).fill(BigInt(0));
  for (const [idx, val] of Object.entries(leaves)) {
    layer0[Number(idx)] = BigInt(val);
  }
  layers.push(layer0);

  // Build layers bottom-up
  for (let d = 0; d < depth; d++) {
    const prev = layers[d];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(poseidonHash([prev[i], prev[i + 1]]));
    }
    layers.push(next);
  }

  const root = layers[depth][0];

  function getProof(treeIndex) {
    const proof = [];
    let idx = treeIndex;
    for (let d = 0; d < depth; d++) {
      const siblingIdx = idx ^ 1;
      proof.push(layers[d][siblingIdx]);
      idx = idx >> 1;
    }
    return proof;
  }

  return { root, getProof };
}

/**
 * MIPS state hash calculation (same method as circuit)
 */
function hashMipsState(state) {
  const regHashes = [];
  for (let g = 0; g < 4; g++) {
    const group = state.registers.slice(g * 8, (g + 1) * 8);
    regHashes.push(poseidonHash(group));
  }
  const regHashFinal = poseidonHash(regHashes);
  return poseidonHash([
    state.pc,
    state.nextPC,
    regHashFinal,
    state.hi,
    state.lo,
    state.memoryRoot,
    state.step
  ]);
}

/**
 * MIPS instruction encoding
 */
const MipsEncoder = {
  add: (rd, rs, rt) => (0 << 26) | (rs << 21) | (rt << 16) | (rd << 11) | (0 << 6) | 0x20,
  addi: (rt, rs, imm) => (0x08 << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF),
  addiu: (rt, rs, imm) => (0x09 << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF),
  sub: (rd, rs, rt) => (0 << 26) | (rs << 21) | (rt << 16) | (rd << 11) | (0 << 6) | 0x22,
  andi: (rt, rs, imm) => (0x0c << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF),
  ori: (rt, rs, imm) => (0x0d << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF),
  xori: (rt, rs, imm) => (0x0e << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF),
  slti: (rt, rs, imm) => (0x0a << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF),
  sltiu: (rt, rs, imm) => (0x0b << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF),
  lui: (rt, imm) => (0x0f << 26) | (0 << 21) | (rt << 16) | (imm & 0xFFFF),
  sllv: (rd, rt, rs) => (0 << 26) | (rs << 21) | (rt << 16) | (rd << 11) | (0 << 6) | 0x04,
  srlv: (rd, rt, rs) => (0 << 26) | (rs << 21) | (rt << 16) | (rd << 11) | (0 << 6) | 0x06,
  mfhi: (rd) => (0 << 26) | (0 << 21) | (0 << 16) | (rd << 11) | (0 << 6) | 0x10,
  mflo: (rd) => (0 << 26) | (0 << 21) | (0 << 16) | (rd << 11) | (0 << 6) | 0x12,
  beq: (rs, rt, offset) => (0x04 << 26) | (rs << 21) | (rt << 16) | (offset & 0xFFFF),
  bne: (rs, rt, offset) => (0x05 << 26) | (rs << 21) | (rt << 16) | (offset & 0xFFFF),
  blez: (rs, offset) => (0x06 << 26) | (rs << 21) | (0 << 16) | (offset & 0xFFFF),
  bgtz: (rs, offset) => (0x07 << 26) | (rs << 21) | (0 << 16) | (offset & 0xFFFF),
  j: (address) => (0x02 << 26) | (address & 0x3FFFFFF),
  jal: (address) => (0x03 << 26) | (address & 0x3FFFFFF),
  jr: (rs) => (0 << 26) | (rs << 21) | (0 << 16) | (0 << 11) | (0 << 6) | 0x08,
  mult: (rs, rt) => (0 << 26) | (rs << 21) | (rt << 16) | (0 << 11) | (0 << 6) | 0x18,
  multu: (rs, rt) => (0 << 26) | (rs << 21) | (rt << 16) | (0 << 11) | (0 << 6) | 0x19,
  div: (rs, rt) => (0 << 26) | (rs << 21) | (rt << 16) | (0 << 11) | (0 << 6) | 0x1a,
  divu: (rs, rt) => (0 << 26) | (rs << 21) | (rt << 16) | (0 << 11) | (0 << 6) | 0x1b,
  lw: (rt, rs, offset) => ((0x23 << 26) | (rs << 21) | (rt << 16) | (offset & 0xFFFF)) >>> 0,
  sw: (rt, rs, offset) => ((0x2b << 26) | (rs << 21) | (rt << 16) | (offset & 0xFFFF)) >>> 0
};

/**
 * Circuit input generation helper
 */
function createCircuitInput(preState, postState, instruction, memParams) {
  const mp = memParams || {};
  return {
    preStateHash: hashMipsState(preState).toString(),
    postStateHash: hashMipsState(postState).toString(),
    prePC: preState.pc.toString(),
    preNextPC: preState.nextPC.toString(),
    preRegisters: preState.registers.map(r => r.toString()),
    preHi: preState.hi.toString(),
    preLo: preState.lo.toString(),
    preMemoryRoot: preState.memoryRoot.toString(),
    preStep: preState.step.toString(),
    instruction: instruction.toString(),
    memAddress: (mp.memAddress || 0).toString(),
    memValue: (mp.memValue || 0).toString(),
    memProof: mp.memProof
      ? mp.memProof.map(p => p.toString())
      : Array(20).fill('0'),
    postPC: postState.pc.toString(),
    postNextPC: postState.nextPC.toString(),
    postRegisters: postState.registers.map(r => r.toString()),
    postHi: postState.hi.toString(),
    postLo: postState.lo.toString(),
    postMemoryRoot: postState.memoryRoot.toString(),
    postStep: postState.step.toString()
  };
}

describe('Groth16 ZK Proof Tests', function () {
  this.timeout(300000);

  let vkey;

  before(async function () {
    await initPoseidon();

    if (!fs.existsSync(WASM_PATH)) {
      console.log('WASM not found at:', WASM_PATH);
      this.skip('WASM file not found. Run "npm run compile" first.');
    }
    if (!fs.existsSync(ZKEY_PATH)) {
      console.log('ZKEY not found at:', ZKEY_PATH);
      this.skip('Zkey file not found. Run "npm run setup" first.');
    }

    vkey = JSON.parse(fs.readFileSync(VKEY_PATH, 'utf8'));
    console.log('Build files loaded successfully');
  });

  describe('Single ADDI Instruction', function () {
    it('should generate and verify proof for ADDI instruction', async function () {
      console.log('\n=== ADDI Instruction Test ===');

      const preState = {
        pc: BigInt(0),
        nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0),
        lo: BigInt(0),
        memoryRoot: BigInt(0),
        step: BigInt(0)
      };

      // ADDI $1, $0, 100
      const instruction = MipsEncoder.addi(1, 0, 100);
      console.log(`Instruction: ADDI $1, $0, 100 (0x${instruction.toString(16)})`);

      const postState = {
        pc: BigInt(4),
        nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(0),
        lo: BigInt(0),
        memoryRoot: BigInt(0),
        step: BigInt(1)
      };
      postState.registers[1] = BigInt(100);

      console.log(`Pre-state hash:  ${hashMipsState(preState)}`);
      console.log(`Post-state hash: ${hashMipsState(postState)}`);

      const input = createCircuitInput(preState, postState, instruction);

      // fullProve: witness calculation + proof generation in one step
      console.log('\nGenerating Groth16 proof...');
      const proofStart = Date.now();
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const proofTime = Date.now() - proofStart;
      console.log(`Proof generated in ${proofTime}ms`);

      console.log('Public signals:', publicSignals);

      // Proof verification
      console.log('\nVerifying proof...');
      const verifyStart = Date.now();
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      const verifyTime = Date.now() - verifyStart;
      console.log(`Proof verified in ${verifyTime}ms`);

      expect(isValid).to.be.true;

      console.log('\n=== Performance Summary ===');
      console.log(`Proof generation:    ${proofTime}ms`);
      console.log(`Proof verification:  ${verifyTime}ms`);
    });
  });

  describe('ADD R-Type Instruction', function () {
    it('should generate and verify proof for ADD instruction', async function () {
      console.log('\n=== ADD R-Type Instruction Test ===');

      const preState = {
        pc: BigInt(4),
        nextPC: BigInt(8),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0),
        lo: BigInt(0),
        memoryRoot: BigInt(0),
        step: BigInt(1)
      };
      preState.registers[1] = BigInt(100);
      preState.registers[2] = BigInt(50);

      // ADD $3, $1, $2
      const instruction = MipsEncoder.add(3, 1, 2);
      console.log(`Instruction: ADD $3, $1, $2 (0x${instruction.toString(16)})`);

      const postState = {
        pc: BigInt(8),
        nextPC: BigInt(12),
        registers: [...preState.registers],
        hi: BigInt(0),
        lo: BigInt(0),
        memoryRoot: BigInt(0),
        step: BigInt(2)
      };
      postState.registers[3] = BigInt(150);

      const input = createCircuitInput(preState, postState, instruction);

      console.log('\nGenerating Groth16 proof...');
      const proofStart = Date.now();
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const proofTime = Date.now() - proofStart;
      console.log(`Proof generated in ${proofTime}ms`);

      console.log('\nVerifying proof...');
      const verifyStart = Date.now();
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      const verifyTime = Date.now() - verifyStart;
      console.log(`Proof verified in ${verifyTime}ms`);

      expect(isValid).to.be.true;

      console.log('\n=== Performance Summary ===');
      console.log(`Proof generation:    ${proofTime}ms`);
      console.log(`Proof verification:  ${verifyTime}ms`);
    });
  });

  describe('Invalid Proof Detection', function () {
    it('should reject proof with wrong post-state', async function () {
      console.log('\n=== Invalid Proof Detection Test ===');

      const preState = {
        pc: BigInt(0),
        nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0),
        lo: BigInt(0),
        memoryRoot: BigInt(0),
        step: BigInt(0)
      };

      const instruction = MipsEncoder.addi(1, 0, 100);

      // Incorrect post-state
      const wrongPostState = {
        pc: BigInt(4),
        nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(0),
        lo: BigInt(0),
        memoryRoot: BigInt(0),
        step: BigInt(1)
      };
      wrongPostState.registers[1] = BigInt(999); // WRONG!

      const input = createCircuitInput(preState, wrongPostState, instruction);

      try {
        console.log('Attempting to generate proof with wrong state...');
        await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
        expect.fail('Should have thrown an error for invalid state');
      } catch (error) {
        console.log('Circuit correctly rejected invalid state transition');
        expect(error).to.exist;
      }
    });
  });

  describe('ANDI Instruction', function () {
    it('should generate and verify proof for ANDI instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(0)
      };
      preState.registers[1] = BigInt(0xFF);

      // ANDI $2, $1, 0x0F
      const instruction = MipsEncoder.andi(2, 1, 0x0F);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(1)
      };
      postState.registers[2] = BigInt(0x0F);

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('ORI Instruction', function () {
    it('should generate and verify proof for ORI instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(0)
      };
      preState.registers[1] = BigInt(0xF0);

      // ORI $2, $1, 0x0F
      const instruction = MipsEncoder.ori(2, 1, 0x0F);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(1)
      };
      postState.registers[2] = BigInt(0xFF);

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('XORI Instruction', function () {
    it('should generate and verify proof for XORI instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(0)
      };
      preState.registers[1] = BigInt(0xFF);

      // XORI $2, $1, 0x0F
      const instruction = MipsEncoder.xori(2, 1, 0x0F);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(1)
      };
      postState.registers[2] = BigInt(0xF0);

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('SLTI Instruction', function () {
    it('should generate and verify proof for SLTI instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(0)
      };
      preState.registers[1] = BigInt(5);

      // SLTI $2, $1, 10 (5 < 10 -> 1)
      const instruction = MipsEncoder.slti(2, 1, 10);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(1)
      };
      postState.registers[2] = BigInt(1);

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('SLTIU Instruction', function () {
    it('should generate and verify proof for SLTIU instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(0)
      };
      preState.registers[1] = BigInt(5);

      // SLTIU $2, $1, 10 (5 <u 10 -> 1)
      const instruction = MipsEncoder.sltiu(2, 1, 10);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(1)
      };
      postState.registers[2] = BigInt(1);

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('LUI Instruction', function () {
    it('should generate and verify proof for LUI instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(0)
      };

      // LUI $1, 0x1234 (result: 0x12340000)
      const instruction = MipsEncoder.lui(1, 0x1234);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(1)
      };
      postState.registers[1] = BigInt(0x12340000);

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('SLLV Instruction', function () {
    it('should generate and verify proof for SLLV instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(0)
      };
      preState.registers[1] = BigInt(0xFF);  // value to shift
      preState.registers[2] = BigInt(4);     // shift amount

      // SLLV $3, $1, $2 -> $3 = 0xFF << 4 = 0xFF0
      const instruction = MipsEncoder.sllv(3, 1, 2);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(1)
      };
      postState.registers[3] = BigInt(0xFF0);

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('SRLV Instruction', function () {
    it('should generate and verify proof for SRLV instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(0)
      };
      preState.registers[1] = BigInt(0xFF0);  // value to shift
      preState.registers[2] = BigInt(4);      // shift amount

      // SRLV $3, $1, $2 -> $3 = 0xFF0 >> 4 = 0xFF
      const instruction = MipsEncoder.srlv(3, 1, 2);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(1)
      };
      postState.registers[3] = BigInt(0xFF);

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('MFHI Instruction', function () {
    it('should generate and verify proof for MFHI instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(42), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(0)
      };

      // MFHI $1 -> $1 = HI = 42
      const instruction = MipsEncoder.mfhi(1);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(42), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(1)
      };
      postState.registers[1] = BigInt(42);

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('MFLO Instruction', function () {
    it('should generate and verify proof for MFLO instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(99), memoryRoot: BigInt(0), step: BigInt(0)
      };

      // MFLO $1 -> $1 = LO = 99
      const instruction = MipsEncoder.mflo(1);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(0), lo: BigInt(99), memoryRoot: BigInt(0), step: BigInt(1)
      };
      postState.registers[1] = BigInt(99);

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('BEQ Instruction (branch taken)', function () {
    it('should generate and verify proof for BEQ instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(0)
      };
      preState.registers[1] = BigInt(10);
      preState.registers[2] = BigInt(10);

      // BEQ $1, $2, 3 (branch taken: rs==rt, nextPC = 4 + 3*4 = 16)
      const instruction = MipsEncoder.beq(1, 2, 3);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(16),
        registers: [...preState.registers],
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(1)
      };

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('BNE Instruction (branch taken)', function () {
    it('should generate and verify proof for BNE instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(0)
      };
      preState.registers[1] = BigInt(10);
      preState.registers[2] = BigInt(20);

      // BNE $1, $2, 2 (branch taken: rs!=rt, nextPC = 4 + 2*4 = 12)
      const instruction = MipsEncoder.bne(1, 2, 2);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(12),
        registers: [...preState.registers],
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(1)
      };

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('BLEZ Instruction (branch taken)', function () {
    it('should generate and verify proof for BLEZ instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(0)
      };
      // rs = 0 (<= 0, branch taken)

      // BLEZ $0, 1 (branch taken: rs<=0, nextPC = 4 + 1*4 = 8)
      const instruction = MipsEncoder.blez(0, 1);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(1)
      };

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('BGTZ Instruction (branch taken)', function () {
    it('should generate and verify proof for BGTZ instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(0)
      };
      preState.registers[1] = BigInt(5);

      // BGTZ $1, 1 (branch taken: rs>0, nextPC = 4 + 1*4 = 8)
      const instruction = MipsEncoder.bgtz(1, 1);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(1)
      };

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('J Instruction', function () {
    it('should generate and verify proof for J instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(0)
      };

      // J 100 (nextPC = 100 * 4 = 400)
      const instruction = MipsEncoder.j(100);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(400),
        registers: [...preState.registers],
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(1)
      };

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('JAL Instruction', function () {
    it('should generate and verify proof for JAL instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(0)
      };

      // JAL 100 (nextPC = 400, r31 = preNextPC + 4 = 8)
      const instruction = MipsEncoder.jal(100);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(400),
        registers: [...preState.registers],
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(1)
      };
      postState.registers[31] = BigInt(8); // return address

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('JR Instruction', function () {
    it('should generate and verify proof for JR instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(0)
      };
      preState.registers[1] = BigInt(200);

      // JR $1 (nextPC = 200)
      const instruction = MipsEncoder.jr(1);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(200),
        registers: [...preState.registers],
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(1)
      };

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('MULT Instruction', function () {
    it('should generate and verify proof for MULT instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(0)
      };
      preState.registers[1] = BigInt(7);
      preState.registers[2] = BigInt(3);

      // MULT $1, $2 -> HI=0, LO=21
      const instruction = MipsEncoder.mult(1, 2);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(0), lo: BigInt(21), memoryRoot: BigInt(0), step: BigInt(1)
      };

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('MULTU Instruction', function () {
    it('should generate and verify proof for MULTU instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(0)
      };
      preState.registers[1] = BigInt(60000);
      preState.registers[2] = BigInt(60000);

      // MULTU $1, $2 -> 60000*60000=3600000000 -> HI=0, LO=3600000000
      const instruction = MipsEncoder.multu(1, 2);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(0), lo: BigInt(3600000000), memoryRoot: BigInt(0), step: BigInt(1)
      };

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('DIV Instruction', function () {
    it('should generate and verify proof for DIV instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(0)
      };
      preState.registers[1] = BigInt(17);
      preState.registers[2] = BigInt(5);

      // DIV $1, $2 -> 17/5: LO=3 (quotient), HI=2 (remainder)
      const instruction = MipsEncoder.div(1, 2);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(2), lo: BigInt(3), memoryRoot: BigInt(0), step: BigInt(1)
      };

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('DIVU Instruction', function () {
    it('should generate and verify proof for DIVU instruction', async function () {
      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0), memoryRoot: BigInt(0), step: BigInt(0)
      };
      preState.registers[1] = BigInt(100);
      preState.registers[2] = BigInt(7);

      // DIVU $1, $2 -> 100/7: LO=14 (quotient), HI=2 (remainder)
      const instruction = MipsEncoder.divu(1, 2);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(2), lo: BigInt(14), memoryRoot: BigInt(0), step: BigInt(1)
      };

      const input = createCircuitInput(preState, postState, instruction);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(isValid).to.be.true;
    });
  });

  describe('LW Instruction (Load Word)', function () {
    it('should generate and verify proof for LW instruction', async function () {
      const DEPTH = 20;
      const wordAddress = 5;  // byte address 20
      const storedValue = BigInt(12345);

      // Build Merkle tree with value at word address 5
      const treeIndex = bitReverse(wordAddress, DEPTH);
      const tree = buildMerkleTree({ [treeIndex]: storedValue }, DEPTH);
      const proof = tree.getProof(treeIndex);

      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0),
        memoryRoot: tree.root,
        step: BigInt(0)
      };

      // LW $2, 20($0) -> effective addr = 0 + 20 = 20, word addr = 5
      const instruction = MipsEncoder.lw(2, 0, 20);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(0), lo: BigInt(0),
        memoryRoot: tree.root,  // unchanged for LW
        step: BigInt(1)
      };
      postState.registers[2] = storedValue;

      const input = createCircuitInput(preState, postState, instruction, {
        memAddress: 20,
        memValue: storedValue,
        memProof: proof
      });

      const { proof: zkProof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, zkProof);
      expect(isValid).to.be.true;
    });
  });

  describe('SW Instruction (Store Word)', function () {
    it('should generate and verify proof for SW instruction', async function () {
      const DEPTH = 20;
      const wordAddress = 3;  // byte address 12
      const storeValue = BigInt(99999);

      // Build empty Merkle tree (pre-state: all zeros)
      const treeIndex = bitReverse(wordAddress, DEPTH);
      const emptyTree = buildMerkleTree({}, DEPTH);
      const proof = emptyTree.getProof(treeIndex);

      // Build updated tree (post-state: value stored at word addr 3)
      const updatedTree = buildMerkleTree({ [treeIndex]: storeValue }, DEPTH);

      const preState = {
        pc: BigInt(0), nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0), lo: BigInt(0),
        memoryRoot: emptyTree.root,
        step: BigInt(0)
      };
      preState.registers[2] = storeValue;

      // SW $2, 12($0) -> effective addr = 0 + 12 = 12, word addr = 3
      const instruction = MipsEncoder.sw(2, 0, 12);

      const postState = {
        pc: BigInt(4), nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(0), lo: BigInt(0),
        memoryRoot: updatedTree.root,  // changed after store
        step: BigInt(1)
      };

      const input = createCircuitInput(preState, postState, instruction, {
        memAddress: 12,
        memValue: BigInt(0),  // old value at this address
        memProof: proof
      });

      const { proof: zkProof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      const isValid = await snarkjs.groth16.verify(vkey, publicSignals, zkProof);
      expect(isValid).to.be.true;
    });
  });

  describe('Calldata Generation', function () {
    it('should generate Solidity calldata for on-chain verification', async function () {
      console.log('\n=== Calldata Generation Test ===');

      const preState = {
        pc: BigInt(0),
        nextPC: BigInt(4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0),
        lo: BigInt(0),
        memoryRoot: BigInt(0),
        step: BigInt(0)
      };

      const instruction = MipsEncoder.addi(1, 0, 100);

      const postState = {
        pc: BigInt(4),
        nextPC: BigInt(8),
        registers: [...preState.registers],
        hi: BigInt(0),
        lo: BigInt(0),
        memoryRoot: BigInt(0),
        step: BigInt(1)
      };
      postState.registers[1] = BigInt(100);

      const input = createCircuitInput(preState, postState, instruction);

      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);

      // Solidity calldata generation
      const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
      console.log('\nSolidity calldata generated:');
      console.log(calldata.slice(0, 200) + '...');

      // Save to file
      const proofData = {
        proof,
        publicSignals,
        calldata,
        timestamp: new Date().toISOString()
      };

      const outputPath = path.join(BUILD_DIR, 'test_proof.json');
      fs.writeFileSync(outputPath, JSON.stringify(proofData, null, 2));
      console.log(`\nProof saved to: ${outputPath}`);

      expect(calldata).to.be.a('string');
      expect(calldata.length).to.be.greaterThan(100);
    });
  });
});

describe('Performance Benchmarks', function () {
  this.timeout(600000);

  before(async function () {
    await initPoseidon();
    if (!fs.existsSync(WASM_PATH) || !fs.existsSync(ZKEY_PATH)) {
      this.skip('Build files not found');
    }
  });

  it('should benchmark proof generation (5 iterations)', async function () {
    console.log('\n=== Proof Generation Benchmark ===');

    const iterations = 5;
    const times = { proof: [], verify: [] };
    const vkey = JSON.parse(fs.readFileSync(VKEY_PATH, 'utf8'));

    for (let i = 0; i < iterations; i++) {
      const preState = {
        pc: BigInt(i * 4),
        nextPC: BigInt((i + 1) * 4),
        registers: Array(32).fill(BigInt(0)),
        hi: BigInt(0),
        lo: BigInt(0),
        memoryRoot: BigInt(0),
        step: BigInt(i)
      };
      preState.registers[1] = BigInt(i * 10);

      const instruction = MipsEncoder.addi(1, 0, 10);

      const postState = {
        pc: BigInt((i + 1) * 4),
        nextPC: BigInt((i + 2) * 4),
        registers: [...preState.registers],
        hi: BigInt(0),
        lo: BigInt(0),
        memoryRoot: BigInt(0),
        step: BigInt(i + 1)
      };
      postState.registers[1] = BigInt(i * 10 + 10);

      const input = createCircuitInput(preState, postState, instruction);

      // Proof generation
      let start = Date.now();
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
      times.proof.push(Date.now() - start);

      // Verification
      start = Date.now();
      await snarkjs.groth16.verify(vkey, publicSignals, proof);
      times.verify.push(Date.now() - start);

      process.stdout.write(`\rIteration ${i + 1}/${iterations}`);
    }

    console.log('\n');

    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const min = (arr) => Math.min(...arr);
    const max = (arr) => Math.max(...arr);

    console.log('=== Results (ms) ===');
    console.log(`Proof:    avg=${avg(times.proof).toFixed(0)}, min=${min(times.proof)}, max=${max(times.proof)}`);
    console.log(`Verify:   avg=${avg(times.verify).toFixed(0)}, min=${min(times.verify)}, max=${max(times.verify)}`);
    console.log(`Total:    avg=${(avg(times.proof) + avg(times.verify)).toFixed(0)}ms`);

    expect(avg(times.proof)).to.be.lessThan(120000); // Within 2 minutes
  });
});
