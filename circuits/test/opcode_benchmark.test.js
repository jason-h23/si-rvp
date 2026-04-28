/**
 * Per-Opcode ZK Proof Benchmark
 *
 * Benchmarks proof generation + verification time for all 25 supported opcodes
 * (excluding LW/SW which require memory root updates).
 *
 * Categories:
 * - R-Type ALU (15): ADD, ADDU, SUB, SUBU, AND, OR, XOR, NOR, SLT, SLTU, SLL, SRL, SRA, SLLV, SRLV
 * - R-Type Special (2): MFHI, MFLO
 * - I-Type ALU (8): ADDI, ADDIU, SLTI, SLTIU, ANDI, ORI, XORI, LUI
 */

const chai = require('chai');
const path = require('path');
const fs = require('fs');
const snarkjs = require('snarkjs');

const expect = chai.expect;

const BUILD_DIR = path.join(__dirname, '..', 'build');
const WASM_PATH = path.join(BUILD_DIR, 'mips_single_step_js', 'mips_single_step.wasm');
const ZKEY_PATH = path.join(BUILD_DIR, 'mips_single_step_final.zkey');
const VKEY_PATH = path.join(BUILD_DIR, 'verification_key.json');
const RESULTS_PATH = path.join(BUILD_DIR, 'opcode_benchmark_results.json');
const HTML_PATH = path.join(BUILD_DIR, 'opcode_benchmark_report.html');

const ITERATIONS = 5;

let poseidon, F;

async function initPoseidon() {
  if (!poseidon) {
    const buildPoseidon = require('circomlibjs').buildPoseidon;
    poseidon = await buildPoseidon();
    F = poseidon.F;
  }
}

function poseidonHash(inputs) {
  const hash = poseidon(inputs.map(x => BigInt(x)));
  return F.toObject(hash);
}

function hashMipsState(state) {
  const regHashes = [];
  for (let g = 0; g < 4; g++) {
    const group = state.registers.slice(g * 8, (g + 1) * 8);
    regHashes.push(poseidonHash(group));
  }
  const regHashFinal = poseidonHash(regHashes);
  return poseidonHash([
    state.pc, state.nextPC, regHashFinal,
    state.hi, state.lo, state.memoryRoot, state.step
  ]);
}

const MipsEncoder = {
  // R-type: (rd, rs, rt) => instruction
  add: (rd, rs, rt) => (0 << 26) | (rs << 21) | (rt << 16) | (rd << 11) | 0x20,
  addu: (rd, rs, rt) => (0 << 26) | (rs << 21) | (rt << 16) | (rd << 11) | 0x21,
  sub: (rd, rs, rt) => (0 << 26) | (rs << 21) | (rt << 16) | (rd << 11) | 0x22,
  subu: (rd, rs, rt) => (0 << 26) | (rs << 21) | (rt << 16) | (rd << 11) | 0x23,
  and: (rd, rs, rt) => (0 << 26) | (rs << 21) | (rt << 16) | (rd << 11) | 0x24,
  or: (rd, rs, rt) => (0 << 26) | (rs << 21) | (rt << 16) | (rd << 11) | 0x25,
  xor: (rd, rs, rt) => (0 << 26) | (rs << 21) | (rt << 16) | (rd << 11) | 0x26,
  nor: (rd, rs, rt) => (0 << 26) | (rs << 21) | (rt << 16) | (rd << 11) | 0x27,
  slt: (rd, rs, rt) => (0 << 26) | (rs << 21) | (rt << 16) | (rd << 11) | 0x2A,
  sltu: (rd, rs, rt) => (0 << 26) | (rs << 21) | (rt << 16) | (rd << 11) | 0x2B,
  sll: (rd, rt, shamt) => (0 << 26) | (rt << 16) | (rd << 11) | (shamt << 6) | 0x00,
  srl: (rd, rt, shamt) => (0 << 26) | (rt << 16) | (rd << 11) | (shamt << 6) | 0x02,
  sra: (rd, rt, shamt) => (0 << 26) | (rt << 16) | (rd << 11) | (shamt << 6) | 0x03,
  sllv: (rd, rt, rs) => (0 << 26) | (rs << 21) | (rt << 16) | (rd << 11) | 0x04,
  srlv: (rd, rt, rs) => (0 << 26) | (rs << 21) | (rt << 16) | (rd << 11) | 0x06,
  mfhi: (rd) => (0 << 26) | (rd << 11) | 0x10,
  mflo: (rd) => (0 << 26) | (rd << 11) | 0x12,

  // I-type: (rt, rs, imm) => instruction
  addi: (rt, rs, imm) => (0x08 << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF),
  addiu: (rt, rs, imm) => (0x09 << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF),
  slti: (rt, rs, imm) => (0x0A << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF),
  sltiu: (rt, rs, imm) => (0x0B << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF),
  andi: (rt, rs, imm) => (0x0C << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF),
  ori: (rt, rs, imm) => (0x0D << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF),
  xori: (rt, rs, imm) => (0x0E << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF),
  lui: (rt, imm) => (0x0F << 26) | (rt << 16) | (imm & 0xFFFF),
};

function createCircuitInput(preState, postState, instruction) {
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
    memAddress: '0',
    memValue: '0',
    memProof: Array(20).fill('0'),
    postPC: postState.pc.toString(),
    postNextPC: postState.nextPC.toString(),
    postRegisters: postState.registers.map(r => r.toString()),
    postHi: postState.hi.toString(),
    postLo: postState.lo.toString(),
    postMemoryRoot: postState.memoryRoot.toString(),
    postStep: postState.step.toString()
  };
}

/**
 * Simulate MIPS instruction execution.
 * Must match circuit behavior exactly.
 */
function simulateMipsInstruction(state, instruction) {
  const newState = {
    pc: state.nextPC,
    nextPC: state.nextPC + BigInt(4),
    registers: [...state.registers],
    hi: state.hi,
    lo: state.lo,
    memoryRoot: state.memoryRoot,
    step: state.step + BigInt(1)
  };

  const opcode = (instruction >> 26) & 0x3F;
  const rs = (instruction >> 21) & 0x1F;
  const rt = (instruction >> 16) & 0x1F;
  const rd = (instruction >> 11) & 0x1F;
  const shamt = (instruction >> 6) & 0x1F;
  const funct = instruction & 0x3F;
  const imm = instruction & 0xFFFF;
  const signExtImm = imm < 0x8000 ? BigInt(imm) : BigInt(imm) - BigInt(0x10000);

  const a = state.registers[rs];
  const b = state.registers[rt];

  if (opcode === 0) {
    // R-type
    let result;
    switch (funct) {
      case 0x00: result = (b << BigInt(shamt)) & BigInt(0xFFFFFFFF); break; // SLL
      case 0x02: result = b >> BigInt(shamt); break; // SRL
      case 0x03: { // SRA — matches circuit Sra(): SRL | (signBit * signExtMask)
        const srlResult = b >> BigInt(shamt);
        const signBit = (b >> BigInt(31)) & BigInt(1);
        if (signBit && shamt > 0) {
          const mask = ((BigInt(1) << BigInt(shamt)) - BigInt(1)) << BigInt(32 - shamt);
          result = (srlResult | mask) & BigInt(0xFFFFFFFF);
        } else {
          result = srlResult & BigInt(0xFFFFFFFF);
        }
        break;
      }
      case 0x04: { // SLLV
        const shamtVal = a & BigInt(0x1F);
        result = (b << shamtVal) & BigInt(0xFFFFFFFF);
        break;
      }
      case 0x06: { // SRLV
        const shamtVal = a & BigInt(0x1F);
        result = b >> shamtVal;
        break;
      }
      case 0x10: result = state.hi; break; // MFHI
      case 0x12: result = state.lo; break; // MFLO
      case 0x20: result = (a + b) & BigInt(0xFFFFFFFF); break; // ADD
      case 0x21: result = (a + b) & BigInt(0xFFFFFFFF); break; // ADDU
      case 0x22: result = (a - b + BigInt(0x100000000)) & BigInt(0xFFFFFFFF); break; // SUB
      case 0x23: result = (a - b + BigInt(0x100000000)) & BigInt(0xFFFFFFFF); break; // SUBU
      case 0x24: result = a & b; break; // AND
      case 0x25: result = a | b; break; // OR
      case 0x26: result = a ^ b; break; // XOR
      case 0x27: result = ~(a | b) & BigInt(0xFFFFFFFF); break; // NOR
      case 0x2A: { // SLT (signed)
        const sa = a >= BigInt(0x80000000) ? a - BigInt(0x100000000) : a;
        const sb = b >= BigInt(0x80000000) ? b - BigInt(0x100000000) : b;
        result = sa < sb ? BigInt(1) : BigInt(0);
        break;
      }
      case 0x2B: result = a < b ? BigInt(1) : BigInt(0); break; // SLTU
      default: result = BigInt(0);
    }
    if (rd !== 0) newState.registers[rd] = result;
  } else {
    // I-type
    let result;
    switch (opcode) {
      case 0x08: // ADDI — circuit: Add32(rsValue, signExtended16bit)
      case 0x09: { // ADDIU — same ALU op as ADDI
        const immUnsigned = (signExtImm + BigInt(0x100000000)) & BigInt(0xFFFFFFFF);
        result = (a + immUnsigned) & BigInt(0xFFFFFFFF);
        break;
      }
      case 0x0A: { // SLTI (signed comparison with sign-extended imm)
        const sa = a >= BigInt(0x80000000) ? a - BigInt(0x100000000) : a;
        result = sa < signExtImm ? BigInt(1) : BigInt(0);
        break;
      }
      case 0x0B: { // SLTIU (unsigned comparison with sign-extended imm)
        // Circuit: sign-extends imm, then does unsigned compare (SLTU aluOp=7)
        const extImm = (signExtImm + BigInt(0x100000000)) & BigInt(0xFFFFFFFF);
        result = a < extImm ? BigInt(1) : BigInt(0);
        break;
      }
      case 0x0C: result = a & BigInt(imm); break; // ANDI (zero-extended)
      case 0x0D: result = a | BigInt(imm); break; // ORI (zero-extended)
      case 0x0E: result = a ^ BigInt(imm); break; // XORI (zero-extended)
      case 0x0F: result = BigInt(imm) << BigInt(16); break; // LUI
      default: result = BigInt(0);
    }
    if (rt !== 0) newState.registers[rt] = result;
  }

  newState.registers[0] = BigInt(0);
  return newState;
}

function calculateStatistics(times) {
  const n = times.length;
  const sorted = [...times].sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const min = sorted[0];
  const max = sorted[n - 1];
  const variance = times.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  return { n, avg: Math.round(avg), median: Math.round(median), min, max, stdDev: Math.round(stdDev) };
}

/**
 * 25 opcode definitions grouped by category.
 * Each entry: { name, category, gen() -> instruction, setupState(state) -> void }
 */
const OPCODE_DEFINITIONS = [
  // R-Type ALU (15)
  { name: 'ADD', category: 'R-Type ALU', gen: () => MipsEncoder.add(3, 1, 2),
    setupState: (s) => { s.registers[1] = BigInt(100); s.registers[2] = BigInt(50); } },
  { name: 'ADDU', category: 'R-Type ALU', gen: () => MipsEncoder.addu(3, 1, 2),
    setupState: (s) => { s.registers[1] = BigInt(100); s.registers[2] = BigInt(50); } },
  { name: 'SUB', category: 'R-Type ALU', gen: () => MipsEncoder.sub(3, 1, 2),
    setupState: (s) => { s.registers[1] = BigInt(100); s.registers[2] = BigInt(50); } },
  { name: 'SUBU', category: 'R-Type ALU', gen: () => MipsEncoder.subu(3, 1, 2),
    setupState: (s) => { s.registers[1] = BigInt(100); s.registers[2] = BigInt(50); } },
  { name: 'AND', category: 'R-Type ALU', gen: () => MipsEncoder.and(3, 1, 2),
    setupState: (s) => { s.registers[1] = BigInt(0xFF); s.registers[2] = BigInt(0x0F); } },
  { name: 'OR', category: 'R-Type ALU', gen: () => MipsEncoder.or(3, 1, 2),
    setupState: (s) => { s.registers[1] = BigInt(0xF0); s.registers[2] = BigInt(0x0F); } },
  { name: 'XOR', category: 'R-Type ALU', gen: () => MipsEncoder.xor(3, 1, 2),
    setupState: (s) => { s.registers[1] = BigInt(0xFF); s.registers[2] = BigInt(0x0F); } },
  { name: 'NOR', category: 'R-Type ALU', gen: () => MipsEncoder.nor(3, 1, 2),
    setupState: (s) => { s.registers[1] = BigInt(0xF0); s.registers[2] = BigInt(0x0F); } },
  { name: 'SLT', category: 'R-Type ALU', gen: () => MipsEncoder.slt(3, 1, 2),
    setupState: (s) => { s.registers[1] = BigInt(10); s.registers[2] = BigInt(20); } },
  { name: 'SLTU', category: 'R-Type ALU', gen: () => MipsEncoder.sltu(3, 1, 2),
    setupState: (s) => { s.registers[1] = BigInt(10); s.registers[2] = BigInt(20); } },
  { name: 'SLL', category: 'R-Type ALU', gen: () => MipsEncoder.sll(3, 1, 4),
    setupState: (s) => { s.registers[1] = BigInt(0xFF); } },
  { name: 'SRL', category: 'R-Type ALU', gen: () => MipsEncoder.srl(3, 1, 4),
    setupState: (s) => { s.registers[1] = BigInt(0xFF0); } },
  { name: 'SRA', category: 'R-Type ALU', gen: () => MipsEncoder.sra(3, 1, 4),
    setupState: (s) => { s.registers[1] = BigInt(0xFF0); } },
  { name: 'SLLV', category: 'R-Type ALU', gen: () => MipsEncoder.sllv(3, 1, 2),
    setupState: (s) => { s.registers[1] = BigInt(0xFF); s.registers[2] = BigInt(4); } },
  { name: 'SRLV', category: 'R-Type ALU', gen: () => MipsEncoder.srlv(3, 1, 2),
    setupState: (s) => { s.registers[1] = BigInt(0xFF0); s.registers[2] = BigInt(4); } },

  // R-Type Special (2)
  { name: 'MFHI', category: 'R-Type Special', gen: () => MipsEncoder.mfhi(3),
    setupState: (s) => { s.hi = BigInt(42); } },
  { name: 'MFLO', category: 'R-Type Special', gen: () => MipsEncoder.mflo(3),
    setupState: (s) => { s.lo = BigInt(99); } },

  // I-Type ALU (8)
  { name: 'ADDI', category: 'I-Type ALU', gen: () => MipsEncoder.addi(3, 1, 100),
    setupState: (s) => { s.registers[1] = BigInt(50); } },
  { name: 'ADDIU', category: 'I-Type ALU', gen: () => MipsEncoder.addiu(3, 1, 100),
    setupState: (s) => { s.registers[1] = BigInt(50); } },
  { name: 'SLTI', category: 'I-Type ALU', gen: () => MipsEncoder.slti(3, 1, 100),
    setupState: (s) => { s.registers[1] = BigInt(50); } },
  { name: 'SLTIU', category: 'I-Type ALU', gen: () => MipsEncoder.sltiu(3, 1, 100),
    setupState: (s) => { s.registers[1] = BigInt(50); } },
  { name: 'ANDI', category: 'I-Type ALU', gen: () => MipsEncoder.andi(3, 1, 0x0F),
    setupState: (s) => { s.registers[1] = BigInt(0xFF); } },
  { name: 'ORI', category: 'I-Type ALU', gen: () => MipsEncoder.ori(3, 1, 0x0F),
    setupState: (s) => { s.registers[1] = BigInt(0xF0); } },
  { name: 'XORI', category: 'I-Type ALU', gen: () => MipsEncoder.xori(3, 1, 0x0F),
    setupState: (s) => { s.registers[1] = BigInt(0xFF); } },
  { name: 'LUI', category: 'I-Type ALU', gen: () => MipsEncoder.lui(3, 0x1234),
    setupState: () => {} },
];

function createBaseState() {
  return {
    pc: BigInt(0),
    nextPC: BigInt(4),
    registers: Array(32).fill(BigInt(0)),
    hi: BigInt(0),
    lo: BigInt(0),
    memoryRoot: BigInt(0),
    step: BigInt(0)
  };
}

describe('Per-Opcode ZK Proof Benchmark', function () {
  this.timeout(3600000);

  let vkey;
  const allResults = [];

  before(async function () {
    await initPoseidon();
    if (!fs.existsSync(WASM_PATH) || !fs.existsSync(ZKEY_PATH) || !fs.existsSync(VKEY_PATH)) {
      console.log('Circuit build files not found. Skipping opcode benchmark.');
      this.skip();
    }
    vkey = JSON.parse(fs.readFileSync(VKEY_PATH, 'utf8'));
  });

  after(function () {
    if (allResults.length === 0) return;

    const output = {
      timestamp: new Date().toISOString(),
      environment: { node: process.version, platform: process.platform, arch: process.arch },
      iterations: ITERATIONS,
      totalOpcodes: allResults.length,
      results: allResults
    };

    fs.writeFileSync(RESULTS_PATH, JSON.stringify(output, null, 2));
    fs.writeFileSync(HTML_PATH, generateHtmlReport(output));
    printResults(allResults);
    console.log(`\nResults saved to: ${RESULTS_PATH}`);
    console.log(`HTML report: ${HTML_PATH}`);
  });

  const categories = [...new Set(OPCODE_DEFINITIONS.map(o => o.category))];

  for (const category of categories) {
    const opcodes = OPCODE_DEFINITIONS.filter(o => o.category === category);

    describe(category, function () {
      for (const opDef of opcodes) {
        it(`${opDef.name} (${ITERATIONS} iterations)`, async function () {
          const proofTimes = [];
          const verifyTimes = [];

          const baseState = createBaseState();
          opDef.setupState(baseState);

          const instruction = opDef.gen();
          const postState = simulateMipsInstruction(baseState, instruction);
          const input = createCircuitInput(baseState, postState, instruction);

          for (let i = 0; i < ITERATIONS; i++) {
            const proofStart = Date.now();
            const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
            proofTimes.push(Date.now() - proofStart);

            const verifyStart = Date.now();
            const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
            verifyTimes.push(Date.now() - verifyStart);

            expect(isValid).to.be.true;
          }

          const proofStats = calculateStatistics(proofTimes);
          const verifyStats = calculateStatistics(verifyTimes);

          allResults.push({
            name: opDef.name,
            category: opDef.category,
            proof: proofStats,
            verify: verifyStats
          });

          console.log(`    proof: avg=${proofStats.avg}ms  verify: avg=${verifyStats.avg}ms`);
        });
      }
    });
  }
});

function generateHtmlReport(data) {
  const { results, timestamp, environment, iterations } = data;

  const catColors = {
    'R-Type ALU': '#3b82f6',
    'R-Type Special': '#8b5cf6',
    'I-Type ALU': '#10b981',
  };

  const overallProofAvg = Math.round(results.reduce((s, r) => s + r.proof.avg, 0) / results.length);
  const overallVerifyAvg = Math.round(results.reduce((s, r) => s + r.verify.avg, 0) / results.length);
  const proofMin = Math.min(...results.map(r => r.proof.min));
  const proofMax = Math.max(...results.map(r => r.proof.max));

  const categories = [...new Set(results.map(r => r.category))];
  const catSummary = categories.map(cat => {
    const cr = results.filter(r => r.category === cat);
    return {
      name: cat,
      count: cr.length,
      proofAvg: Math.round(cr.reduce((s, r) => s + r.proof.avg, 0) / cr.length),
      verifyAvg: Math.round(cr.reduce((s, r) => s + r.verify.avg, 0) / cr.length),
    };
  });

  const tableRows = results.map(r => {
    const color = catColors[r.category] || '#6b7280';
    return `<tr>
      <td><code>${r.name}</code></td>
      <td><span class="cat-badge" style="background:${color}20;color:${color};border:1px solid ${color}40">${r.category}</span></td>
      <td class="num">${r.proof.avg}</td>
      <td class="num dim">${r.proof.min}</td>
      <td class="num dim">${r.proof.max}</td>
      <td class="num dim">${r.proof.stdDev}</td>
      <td class="num">${r.verify.avg}</td>
      <td class="num dim">${r.verify.min}</td>
      <td class="num dim">${r.verify.max}</td>
      <td><div class="bar-wrap"><div class="bar" style="width:${Math.round((r.proof.avg / proofMax) * 100)}%;background:${color}"></div></div></td>
    </tr>`;
  }).join('\n');

  const chartBars = results.map(r => {
    const color = catColors[r.category] || '#6b7280';
    const pct = Math.round((r.proof.avg / proofMax) * 100);
    return `<div class="chart-row">
      <div class="chart-label">${r.name}</div>
      <div class="chart-bar-wrap">
        <div class="chart-bar" style="width:${pct}%;background:${color}">
          <span class="chart-val">${r.proof.avg}ms</span>
        </div>
        <div class="chart-range" style="left:${Math.round((r.proof.min / proofMax) * 100)}%;width:${Math.round(((r.proof.max - r.proof.min) / proofMax) * 100)}%"></div>
      </div>
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SI-RVP ZK Opcode Benchmark</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; line-height: 1.5; }
  .container { max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 1.75rem; font-weight: 700; margin-bottom: 0.25rem; }
  .subtitle { color: #94a3b8; font-size: 0.875rem; margin-bottom: 2rem; }

  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .card { background: #1e293b; border-radius: 12px; padding: 1.25rem; border: 1px solid #334155; }
  .card-label { font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem; }
  .card-value { font-size: 1.75rem; font-weight: 700; }
  .card-value .unit { font-size: 0.875rem; font-weight: 400; color: #94a3b8; }

  .section { background: #1e293b; border-radius: 12px; padding: 1.5rem; border: 1px solid #334155; margin-bottom: 2rem; }
  .section-title { font-size: 1.125rem; font-weight: 600; margin-bottom: 1rem; }

  .chart-row { display: flex; align-items: center; margin-bottom: 4px; }
  .chart-label { width: 60px; font-size: 0.75rem; font-family: monospace; text-align: right; padding-right: 10px; color: #cbd5e1; flex-shrink: 0; }
  .chart-bar-wrap { flex: 1; height: 24px; position: relative; background: #0f172a; border-radius: 4px; overflow: hidden; }
  .chart-bar { height: 100%; border-radius: 4px; display: flex; align-items: center; justify-content: flex-end; padding-right: 8px; transition: width 0.3s; min-width: 50px; }
  .chart-val { font-size: 0.7rem; font-weight: 600; color: #fff; white-space: nowrap; }
  .chart-range { position: absolute; top: 9px; height: 6px; background: rgba(255,255,255,0.15); border-radius: 3px; pointer-events: none; }

  table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
  th { text-align: left; padding: 0.625rem 0.75rem; border-bottom: 2px solid #334155; color: #94a3b8; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; }
  td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #1e293b; }
  tr:hover td { background: #1e293b; }
  .num { text-align: right; font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace; }
  .dim { color: #64748b; }
  code { background: #334155; padding: 2px 6px; border-radius: 4px; font-size: 0.8125rem; font-weight: 600; }
  .cat-badge { font-size: 0.6875rem; padding: 2px 8px; border-radius: 9999px; white-space: nowrap; }

  .bar-wrap { width: 100%; height: 8px; background: #0f172a; border-radius: 4px; overflow: hidden; }
  .bar { height: 100%; border-radius: 4px; }

  .legend { display: flex; gap: 1.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: #94a3b8; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; }

  .footer { text-align: center; color: #475569; font-size: 0.75rem; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #1e293b; }
</style>
</head>
<body>
<div class="container">
  <h1>SI-RVP ZK Opcode Benchmark</h1>
  <p class="subtitle">Groth16 proof generation & verification time per MIPS opcode &middot; ${iterations} iterations &middot; ${environment.platform}/${environment.arch} &middot; Node ${environment.node}</p>

  <div class="cards">
    <div class="card">
      <div class="card-label">Opcodes Tested</div>
      <div class="card-value">${results.length} <span class="unit">/ 25</span></div>
    </div>
    <div class="card">
      <div class="card-label">Proof Avg</div>
      <div class="card-value">${overallProofAvg} <span class="unit">ms</span></div>
    </div>
    <div class="card">
      <div class="card-label">Verify Avg</div>
      <div class="card-value">${overallVerifyAvg} <span class="unit">ms</span></div>
    </div>
    <div class="card">
      <div class="card-label">Proof Range</div>
      <div class="card-value">${proofMin}<span class="unit">ms</span> ~ ${proofMax}<span class="unit">ms</span></div>
    </div>
    ${catSummary.map(c => `<div class="card">
      <div class="card-label">${c.name} (${c.count})</div>
      <div class="card-value">${c.proofAvg} <span class="unit">ms proof</span></div>
    </div>`).join('\n    ')}
  </div>

  <div class="section">
    <div class="section-title">Proof Generation Time by Opcode</div>
    <div class="legend">
      ${categories.map(c => `<div class="legend-item"><div class="legend-dot" style="background:${catColors[c]}"></div>${c}</div>`).join('\n      ')}
      <div class="legend-item" style="margin-left:auto;color:#475569">bar = avg, line = min~max range</div>
    </div>
    ${chartBars}
  </div>

  <div class="section">
    <div class="section-title">Detailed Results</div>
    <table>
      <thead>
        <tr>
          <th>Opcode</th><th>Category</th>
          <th class="num">Proof Avg</th><th class="num">Min</th><th class="num">Max</th><th class="num">StdDev</th>
          <th class="num">Verify Avg</th><th class="num">Min</th><th class="num">Max</th>
          <th style="width:20%">Relative</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  </div>

  <div class="footer">
    Generated: ${timestamp} &middot; SI-RVP Protocol
  </div>
</div>
</body>
</html>`;
}

function printResults(results) {
  console.log('\n');
  console.log('='.repeat(100));
  console.log('                        PER-OPCODE ZK PROOF BENCHMARK RESULTS');
  console.log('='.repeat(100));

  console.log(`\n[Table] Proof Generation & Verification Time (${ITERATIONS} iterations per opcode)\n`);
  console.log('+------------------+----------------+----------+----------+----------+----------+----------+----------+');
  console.log('| Opcode           | Category       | Proof    | Proof    | Proof    | Verify   | Verify   | Verify   |');
  console.log('|                  |                | Avg (ms) | Min (ms) | Max (ms) | Avg (ms) | Min (ms) | Max (ms) |');
  console.log('+------------------+----------------+----------+----------+----------+----------+----------+----------+');

  for (const r of results) {
    const name = r.name.padEnd(16);
    const cat = r.category.padEnd(14);
    const pAvg = r.proof.avg.toString().padStart(8);
    const pMin = r.proof.min.toString().padStart(8);
    const pMax = r.proof.max.toString().padStart(8);
    const vAvg = r.verify.avg.toString().padStart(8);
    const vMin = r.verify.min.toString().padStart(8);
    const vMax = r.verify.max.toString().padStart(8);
    console.log(`| ${name} | ${cat} | ${pAvg} | ${pMin} | ${pMax} | ${vAvg} | ${vMin} | ${vMax} |`);
  }
  console.log('+------------------+----------------+----------+----------+----------+----------+----------+----------+');

  // Summary by category
  const categories = [...new Set(results.map(r => r.category))];
  console.log('\n[Summary] Average by Category\n');
  console.log('+------------------+--------+----------------+----------------+');
  console.log('| Category         | Count  | Proof Avg (ms) | Verify Avg(ms) |');
  console.log('+------------------+--------+----------------+----------------+');

  let totalProof = 0;
  let totalVerify = 0;

  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const avgProof = Math.round(catResults.reduce((s, r) => s + r.proof.avg, 0) / catResults.length);
    const avgVerify = Math.round(catResults.reduce((s, r) => s + r.verify.avg, 0) / catResults.length);
    totalProof += catResults.reduce((s, r) => s + r.proof.avg, 0);
    totalVerify += catResults.reduce((s, r) => s + r.verify.avg, 0);
    console.log(`| ${cat.padEnd(16)} | ${catResults.length.toString().padStart(6)} | ${avgProof.toString().padStart(14)} | ${avgVerify.toString().padStart(14)} |`);
  }

  const overallProof = Math.round(totalProof / results.length);
  const overallVerify = Math.round(totalVerify / results.length);
  console.log('+------------------+--------+----------------+----------------+');
  console.log(`| ${'OVERALL'.padEnd(16)} | ${results.length.toString().padStart(6)} | ${overallProof.toString().padStart(14)} | ${overallVerify.toString().padStart(14)} |`);
  console.log('+------------------+--------+----------------+----------------+');

  console.log('\n' + '='.repeat(100));
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log('='.repeat(100));
}
