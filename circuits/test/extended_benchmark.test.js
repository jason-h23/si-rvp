/**
 * Extended Benchmark Test for Dissertation
 *
 * Extended benchmark for thesis - more iterations and various instruction tests
 * - 10 iterations for improved reliability
 * - Performance analysis by instruction type
 * - Various program sizes (10 ~ 1000)
 */

const chai = require('chai');
const path = require('path');
const fs = require('fs');
const snarkjs = require('snarkjs');

const expect = chai.expect;

const BUILD_DIR = path.join(__dirname, '..', 'build');
const WASM_PATH = path.join(BUILD_DIR, 'mips_single_step_js', 'mips_single_step.wasm');
const ZKEY_PATH = path.join(BUILD_DIR, 'mips_single_step_final.zkey');
const RESULTS_PATH = path.join(BUILD_DIR, 'extended_benchmark_results.json');

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
  // I-type instructions
  addi: (rt, rs, imm) => (0x08 << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF),
  addiu: (rt, rs, imm) => (0x09 << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF),
  andi: (rt, rs, imm) => (0x0C << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF),
  ori: (rt, rs, imm) => (0x0D << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF),
  xori: (rt, rs, imm) => (0x0E << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF),
  lui: (rt, imm) => (0x0F << 26) | (rt << 16) | (imm & 0xFFFF),
  slti: (rt, rs, imm) => (0x0A << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF),

  // R-type instructions
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
};

// Instruction categories for testing
const INSTRUCTION_CATEGORIES = {
  arithmetic: [
    { name: 'ADD', gen: () => MipsEncoder.add(3, 1, 2) },
    { name: 'SUB', gen: () => MipsEncoder.sub(3, 1, 2) },
    { name: 'ADDI', gen: () => MipsEncoder.addi(3, 1, 100) },
  ],
  logical: [
    { name: 'AND', gen: () => MipsEncoder.and(3, 1, 2) },
    { name: 'OR', gen: () => MipsEncoder.or(3, 1, 2) },
    { name: 'XOR', gen: () => MipsEncoder.xor(3, 1, 2) },
    { name: 'ANDI', gen: () => MipsEncoder.andi(3, 1, 0xFF) },
    { name: 'ORI', gen: () => MipsEncoder.ori(3, 1, 0xFF) },
  ],
  shift: [
    { name: 'SLL', gen: () => MipsEncoder.sll(3, 1, 4) },
    { name: 'SRL', gen: () => MipsEncoder.srl(3, 1, 4) },
    { name: 'SRA', gen: () => MipsEncoder.sra(3, 1, 4) },
  ],
  comparison: [
    { name: 'SLT', gen: () => MipsEncoder.slt(3, 1, 2) },
    { name: 'SLTU', gen: () => MipsEncoder.sltu(3, 1, 2) },
    { name: 'SLTI', gen: () => MipsEncoder.slti(3, 1, 50) },
  ],
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
      case 0x03: // SRA
        if (b & BigInt(0x80000000)) {
          result = (b >> BigInt(shamt)) | (BigInt(0xFFFFFFFF) << BigInt(32 - shamt));
        } else {
          result = b >> BigInt(shamt);
        }
        result = result & BigInt(0xFFFFFFFF);
        break;
      case 0x20: result = (a + b) & BigInt(0xFFFFFFFF); break; // ADD
      case 0x21: result = (a + b) & BigInt(0xFFFFFFFF); break; // ADDU
      case 0x22: result = (a - b + BigInt(0x100000000)) & BigInt(0xFFFFFFFF); break; // SUB
      case 0x23: result = (a - b + BigInt(0x100000000)) & BigInt(0xFFFFFFFF); break; // SUBU
      case 0x24: result = a & b; break; // AND
      case 0x25: result = a | b; break; // OR
      case 0x26: result = a ^ b; break; // XOR
      case 0x27: result = ~(a | b) & BigInt(0xFFFFFFFF); break; // NOR
      case 0x2A: result = a < b ? BigInt(1) : BigInt(0); break; // SLT
      case 0x2B: result = a < b ? BigInt(1) : BigInt(0); break; // SLTU
      default: result = BigInt(0);
    }
    if (rd !== 0) newState.registers[rd] = result;
  } else {
    // I-type
    let result;
    switch (opcode) {
      case 0x08: result = (a + signExtImm) & BigInt(0xFFFFFFFF); break; // ADDI
      case 0x09: result = (a + signExtImm) & BigInt(0xFFFFFFFF); break; // ADDIU
      case 0x0A: result = a < signExtImm ? BigInt(1) : BigInt(0); break; // SLTI
      case 0x0C: result = a & BigInt(imm); break; // ANDI
      case 0x0D: result = a | BigInt(imm); break; // ORI
      case 0x0E: result = a ^ BigInt(imm); break; // XORI
      case 0x0F: result = BigInt(imm) << BigInt(16); break; // LUI
      default: result = BigInt(0);
    }
    if (rt !== 0) newState.registers[rt] = result;
  }

  newState.registers[0] = BigInt(0); // $0 always 0
  return newState;
}

function calculateStatistics(times) {
  const n = times.length;
  const sorted = [...times].sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 === 0 ? (sorted[n/2 - 1] + sorted[n/2]) / 2 : sorted[Math.floor(n/2)];
  const min = sorted[0];
  const max = sorted[n - 1];
  const variance = times.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  // 95% confidence interval (using t-distribution approximation for small samples)
  const tValue = 2.262; // t-value for 95% CI with df=9
  const stdError = stdDev / Math.sqrt(n);
  const ci95Lower = avg - tValue * stdError;
  const ci95Upper = avg + tValue * stdError;

  // Remove outliers (outside 1.5*IQR)
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  const outliers = times.filter(t => t < lowerBound || t > upperBound);

  return {
    n,
    avg: Math.round(avg),
    median: Math.round(median),
    min,
    max,
    stdDev: Math.round(stdDev),
    ci95Lower: Math.round(ci95Lower),
    ci95Upper: Math.round(ci95Upper),
    outlierCount: outliers.length,
    rawTimes: times
  };
}

function simulateBisection(programSize) {
  const rounds = Math.ceil(Math.log2(programSize));
  const messagesPerRound = 2;
  const totalMessages = rounds * messagesPerRound;
  return { rounds, totalMessages };
}

describe('Extended Dissertation Benchmarks', function () {
  this.timeout(3600000); // 1 hour

  const results = {
    timestamp: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    proofGeneration: [],
    instructionTypeAnalysis: [],
    bisectionAnalysis: [],
    gasCosts: {
      zkVerification: 233464,
      initiateDispute: 274243,
      depositSequencerBond: 46098,
      submitBisectionResult: 88249
    },
    statisticalSummary: {}
  };

  before(async function () {
    await initPoseidon();
    if (!fs.existsSync(WASM_PATH) || !fs.existsSync(ZKEY_PATH)) {
      console.log('Circuit files not found. Skipping extended benchmarks.');
      this.skip();
    }
  });

  after(function () {
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
    console.log(`\nExtended results saved to: ${RESULTS_PATH}`);
    printExtendedResults(results);
  });

  describe('Program Size Benchmark (10 iterations each)', function () {
    const programSizes = [10, 25, 50, 100, 200, 500, 1000];
    const ITERATIONS = 10;

    for (const size of programSizes) {
      it(`should benchmark ${size} instructions with ${ITERATIONS} iterations`, async function () {
        console.log(`\n--- Program Size: ${size} instructions ---`);

        const times = [];
        const baseState = {
          pc: BigInt(0),
          nextPC: BigInt(4),
          registers: Array(32).fill(BigInt(0)),
          hi: BigInt(0),
          lo: BigInt(0),
          memoryRoot: BigInt(0),
          step: BigInt(0)
        };

        // Initialize $1 and $2
        baseState.registers[1] = BigInt(100);
        baseState.registers[2] = BigInt(50);

        // Single instruction for the disputed step
        const instruction = MipsEncoder.add(3, 1, 2);
        const postState = simulateMipsInstruction(baseState, instruction);
        const input = createCircuitInput(baseState, postState, instruction);

        for (let iter = 0; iter < ITERATIONS; iter++) {
          const start = Date.now();
          await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
          const elapsed = Date.now() - start;
          times.push(elapsed);
          process.stdout.write(`  Iteration ${iter + 1}/${ITERATIONS}: ${elapsed}ms\n`);
        }

        const stats = calculateStatistics(times);
        const bisection = simulateBisection(size);

        results.proofGeneration.push({
          programSize: size,
          iterations: ITERATIONS,
          ...stats,
          bisectionRounds: bisection.rounds,
          totalMessages: bisection.totalMessages
        });

        console.log(`  Average: ${stats.avg}ms (95% CI: ${stats.ci95Lower}-${stats.ci95Upper}ms)`);
        console.log(`  Std Dev: ${stats.stdDev}ms, Outliers: ${stats.outlierCount}`);
      });
    }
  });

  describe('Instruction Type Analysis', function () {
    const ITERATIONS = 10;

    for (const [category, instructions] of Object.entries(INSTRUCTION_CATEGORIES)) {
      describe(`${category.charAt(0).toUpperCase() + category.slice(1)} Instructions`, function () {
        for (const instr of instructions) {
          it(`should benchmark ${instr.name} instruction`, async function () {
            console.log(`\n--- ${instr.name} (${category}) ---`);

            const times = [];
            const baseState = {
              pc: BigInt(0),
              nextPC: BigInt(4),
              registers: Array(32).fill(BigInt(0)),
              hi: BigInt(0),
              lo: BigInt(0),
              memoryRoot: BigInt(0),
              step: BigInt(0)
            };

            baseState.registers[1] = BigInt(100);
            baseState.registers[2] = BigInt(50);

            const instruction = instr.gen();
            const postState = simulateMipsInstruction(baseState, instruction);
            const input = createCircuitInput(baseState, postState, instruction);

            for (let iter = 0; iter < ITERATIONS; iter++) {
              const start = Date.now();
              await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
              const elapsed = Date.now() - start;
              times.push(elapsed);
            }

            const stats = calculateStatistics(times);

            results.instructionTypeAnalysis.push({
              category,
              instruction: instr.name,
              ...stats
            });

            console.log(`  Average: ${stats.avg}ms (95% CI: ${stats.ci95Lower}-${stats.ci95Upper}ms)`);
          });
        }
      });
    }
  });

  describe('Extended Bisection Analysis', function () {
    it('should analyze bisection for extended program sizes', function () {
      console.log('\n--- Extended Bisection Analysis ---');

      const sizes = [10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000];

      for (const size of sizes) {
        const bisection = simulateBisection(size);
        const traditionalGas = bisection.rounds * 50000;
        const proposedGas = results.gasCosts.initiateDispute +
                          results.gasCosts.depositSequencerBond +
                          results.gasCosts.zkVerification;
        const gasReduction = ((traditionalGas - proposedGas) / traditionalGas * 100).toFixed(1);

        results.bisectionAnalysis.push({
          programSize: size,
          bisectionRounds: bisection.rounds,
          totalMessages: bisection.totalMessages,
          traditionalGas,
          proposedGas,
          gasReductionPercent: parseFloat(gasReduction)
        });

        console.log(`  ${size.toLocaleString().padStart(10)} instructions: ${bisection.rounds} rounds, ${gasReduction}% reduction`);
      }
    });
  });

  describe('Statistical Summary', function () {
    it('should generate statistical summary', function () {
      if (results.proofGeneration.length === 0) {
        this.skip();
        return;
      }

      const allTimes = results.proofGeneration.flatMap(p => p.rawTimes || []);
      const allStats = calculateStatistics(allTimes);

      results.statisticalSummary = {
        totalMeasurements: allTimes.length,
        overallAvg: allStats.avg,
        overallMedian: allStats.median,
        overallMin: allStats.min,
        overallMax: allStats.max,
        overallStdDev: allStats.stdDev,
        ci95: `${allStats.ci95Lower}-${allStats.ci95Upper}ms`
      };

      console.log('\n--- Statistical Summary ---');
      console.log(`  Total measurements: ${allTimes.length}`);
      console.log(`  Overall average: ${allStats.avg}ms`);
      console.log(`  Overall median: ${allStats.median}ms`);
      console.log(`  Overall std dev: ${allStats.stdDev}ms`);
      console.log(`  95% CI: ${allStats.ci95Lower}-${allStats.ci95Upper}ms`);
    });
  });
});

function printExtendedResults(results) {
  console.log('\n');
  console.log('═'.repeat(90));
  console.log('                      EXTENDED BENCHMARK RESULTS');
  console.log('═'.repeat(90));

  // Proof Generation Table
  console.log('\n[Table 1] ZK Proof Generation Time (10 iterations per size)\n');
  console.log('┌───────────────┬──────────┬──────────┬──────────┬───────────────────────┬──────────┐');
  console.log('│ Program Size  │ Avg (ms) │ Median   │ Std Dev  │ 95% CI                │ Outliers │');
  console.log('├───────────────┼──────────┼──────────┼──────────┼───────────────────────┼──────────┤');

  for (const p of results.proofGeneration) {
    const ci = `${p.ci95Lower}-${p.ci95Upper}`;
    console.log(`│ ${p.programSize.toString().padStart(13)} │ ${p.avg.toString().padStart(8)} │ ${p.median.toString().padStart(8)} │ ${p.stdDev.toString().padStart(8)} │ ${ci.padStart(21)} │ ${p.outlierCount.toString().padStart(8)} │`);
  }
  console.log('└───────────────┴──────────┴──────────┴──────────┴───────────────────────┴──────────┘');

  // Instruction Type Table
  if (results.instructionTypeAnalysis.length > 0) {
    console.log('\n[Table 2] Proof Time by Instruction Type\n');
    console.log('┌────────────────┬─────────────┬──────────┬──────────┬───────────────────────┐');
    console.log('│ Category       │ Instruction │ Avg (ms) │ Std Dev  │ 95% CI                │');
    console.log('├────────────────┼─────────────┼──────────┼──────────┼───────────────────────┤');

    for (const i of results.instructionTypeAnalysis) {
      const ci = `${i.ci95Lower}-${i.ci95Upper}`;
      console.log(`│ ${i.category.padEnd(14)} │ ${i.instruction.padEnd(11)} │ ${i.avg.toString().padStart(8)} │ ${i.stdDev.toString().padStart(8)} │ ${ci.padStart(21)} │`);
    }
    console.log('└────────────────┴─────────────┴──────────┴──────────┴───────────────────────┘');
  }

  // Bisection Analysis
  console.log('\n[Table 3] Gas Cost Analysis by Program Size\n');
  console.log('┌───────────────┬──────────┬────────────────┬────────────────┬────────────┐');
  console.log('│ Program Size  │ Rounds   │ Traditional    │ Proposed       │ Reduction  │');
  console.log('├───────────────┼──────────┼────────────────┼────────────────┼────────────┤');

  for (const b of results.bisectionAnalysis) {
    console.log(`│ ${b.programSize.toLocaleString().padStart(13)} │ ${b.bisectionRounds.toString().padStart(8)} │ ${b.traditionalGas.toLocaleString().padStart(14)} │ ${b.proposedGas.toLocaleString().padStart(14)} │ ${(b.gasReductionPercent + '%').padStart(10)} │`);
  }
  console.log('└───────────────┴──────────┴────────────────┴────────────────┴────────────┘');

  // Statistical Summary
  if (results.statisticalSummary.totalMeasurements) {
    console.log('\n[Table 4] Statistical Summary\n');
    console.log('┌─────────────────────────────┬────────────────────┐');
    console.log(`│ Total Measurements          │ ${results.statisticalSummary.totalMeasurements.toString().padStart(18)} │`);
    console.log(`│ Overall Average             │ ${(results.statisticalSummary.overallAvg + 'ms').padStart(18)} │`);
    console.log(`│ Overall Median              │ ${(results.statisticalSummary.overallMedian + 'ms').padStart(18)} │`);
    console.log(`│ Overall Std Dev             │ ${(results.statisticalSummary.overallStdDev + 'ms').padStart(18)} │`);
    console.log(`│ 95% Confidence Interval     │ ${results.statisticalSummary.ci95.padStart(18)} │`);
    console.log('└─────────────────────────────┴────────────────────┘');
  }

  console.log('\n═'.repeat(90));
  console.log(`Generated: ${results.timestamp}`);
  console.log('═'.repeat(90));
}
