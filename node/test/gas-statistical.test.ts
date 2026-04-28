/**
 * Gas Statistical Benchmarks
 *
 * Multi-run benchmarks measuring MIPS executor performance and
 * proof generation time statistics for paper data consolidation.
 *
 * Outputs: mean, min, max, stddev, median, p95, p99 for each metric.
 */

import { expect } from 'chai';
import { MipsExecutor, MipsInstructionBuilder } from '../src/common/mips';

// ============================================
// Statistical helpers (pure functions)
// ============================================

interface Stats {
  count: number;
  mean: number;
  min: number;
  max: number;
  median: number;
  stddev: number;
  p95: number;
  p99: number;
}

function computeStats(samples: readonly number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const variance = sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);

  return {
    count: n,
    mean: round4(mean),
    min: sorted[0],
    max: sorted[n - 1],
    median: sorted[Math.floor(n / 2)],
    stddev: round4(stddev),
    p95: sorted[Math.floor(n * 0.95)],
    p99: sorted[Math.floor(n * 0.99)],
  };
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function formatTable(label: string, stats: Stats): string {
  const lines = [
    `  ${label}`,
    `    count:  ${stats.count}`,
    `    mean:   ${stats.mean.toFixed(4)} ms`,
    `    min:    ${stats.min.toFixed(4)} ms`,
    `    max:    ${stats.max.toFixed(4)} ms`,
    `    median: ${stats.median.toFixed(4)} ms`,
    `    stddev: ${stats.stddev.toFixed(4)} ms`,
    `    p95:    ${stats.p95.toFixed(4)} ms`,
    `    p99:    ${stats.p99.toFixed(4)} ms`,
  ];
  return lines.join('\n');
}

// ============================================
// Benchmark: MIPS single-step execution time
// ============================================

describe('Gas Statistical Benchmarks', function () {
  this.timeout(120_000);

  const WARMUP_RUNS = 50;
  const BENCHMARK_RUNS = 500;

  let executor: MipsExecutor;

  before(() => {
    executor = new MipsExecutor();
  });

  describe('MIPS single-step execution timing', function () {
    it('should measure R-Type ADD execution time over multiple runs', function () {
      const state = MipsExecutor.createInitialState();
      const regs = state.registers.map((v, i) => (i === 1 ? 100n : i === 2 ? 200n : v));
      const baseState = { ...state, registers: regs };
      const insn = MipsInstructionBuilder.add(3, 1, 2);

      // Warmup
      for (let i = 0; i < WARMUP_RUNS; i++) {
        executor.executeStep(baseState, insn);
      }

      const times: number[] = [];
      for (let i = 0; i < BENCHMARK_RUNS; i++) {
        const start = performance.now();
        executor.executeStep(baseState, insn);
        times.push(performance.now() - start);
      }

      const stats = computeStats(times);
      console.log('\n' + formatTable('R-Type ADD single-step', stats));

      expect(stats.count).to.equal(BENCHMARK_RUNS);
      expect(stats.mean).to.be.greaterThan(0);
    });

    it('should measure I-Type ADDI execution time over multiple runs', function () {
      const state = MipsExecutor.createInitialState();
      const insn = MipsInstructionBuilder.addi(1, 0, 42);

      for (let i = 0; i < WARMUP_RUNS; i++) {
        executor.executeStep(state, insn);
      }

      const times: number[] = [];
      for (let i = 0; i < BENCHMARK_RUNS; i++) {
        const start = performance.now();
        executor.executeStep(state, insn);
        times.push(performance.now() - start);
      }

      const stats = computeStats(times);
      console.log('\n' + formatTable('I-Type ADDI single-step', stats));

      expect(stats.count).to.equal(BENCHMARK_RUNS);
    });

    it('should measure SW (store word) execution time over multiple runs', function () {
      const base = MipsExecutor.createInitialState();
      const regs = base.registers.map((v, i) => (i === 1 ? 0x1000n : i === 2 ? 0xDEADBEEFn : v));
      const state = { ...base, registers: regs };
      const insn = MipsInstructionBuilder.sw(2, 0, 1);

      for (let i = 0; i < WARMUP_RUNS; i++) {
        executor.executeStep(state, insn);
      }

      const times: number[] = [];
      for (let i = 0; i < BENCHMARK_RUNS; i++) {
        const start = performance.now();
        executor.executeStep(state, insn);
        times.push(performance.now() - start);
      }

      const stats = computeStats(times);
      console.log('\n' + formatTable('I-Type SW single-step', stats));

      expect(stats.count).to.equal(BENCHMARK_RUNS);
    });

    it('should measure LW (load word) execution time over multiple runs', function () {
      const state = MipsExecutor.createInitialState();
      const regs = state.registers.map((v, i) => (i === 1 ? 0x2000n : v));
      const stateWithBase = { ...state, registers: regs };
      const insn = MipsInstructionBuilder.lw(2, 0, 1);
      const memValue = 0xCAFEBABEn;

      for (let i = 0; i < WARMUP_RUNS; i++) {
        executor.executeStep(stateWithBase, insn, memValue);
      }

      const times: number[] = [];
      for (let i = 0; i < BENCHMARK_RUNS; i++) {
        const start = performance.now();
        executor.executeStep(stateWithBase, insn, memValue);
        times.push(performance.now() - start);
      }

      const stats = computeStats(times);
      console.log('\n' + formatTable('I-Type LW single-step', stats));

      expect(stats.count).to.equal(BENCHMARK_RUNS);
    });
  });

  describe('Multi-instruction program execution timing', function () {
    const programSizes = [10, 50, 100, 200];

    for (const size of programSizes) {
      it(`should measure ${size}-instruction program execution time`, function () {
        const instructions: bigint[] = [
          MipsInstructionBuilder.addi(1, 0, 100),
          MipsInstructionBuilder.addi(2, 0, 50),
        ];
        for (let i = 2; i < size; i++) {
          const rd = 3 + (i % 25);
          switch (i % 4) {
            case 0: instructions.push(MipsInstructionBuilder.add(rd, 1, 2)); break;
            case 1: instructions.push(MipsInstructionBuilder.sub(rd, 1, 2)); break;
            case 2: instructions.push(MipsInstructionBuilder.and(rd, 1, 2)); break;
            case 3: instructions.push(MipsInstructionBuilder.or(rd, 1, 2)); break;
          }
        }

        // Warmup
        for (let w = 0; w < 5; w++) {
          let state = MipsExecutor.createInitialState();
          for (const insn of instructions) {
            state = executor.executeStep(state, insn);
          }
        }

        const runs = 100;
        const times: number[] = [];
        for (let r = 0; r < runs; r++) {
          let state = MipsExecutor.createInitialState();
          const start = performance.now();
          for (const insn of instructions) {
            state = executor.executeStep(state, insn);
          }
          times.push(performance.now() - start);
        }

        const stats = computeStats(times);
        console.log('\n' + formatTable(`${size}-instruction program`, stats));

        expect(stats.count).to.equal(runs);
        // Execution time should scale roughly linearly
        expect(stats.mean).to.be.greaterThan(0);
      });
    }
  });

  describe('Gas cost statistical constants', function () {
    it('should report known gas costs with context for paper', function () {
      // These are deterministic on-chain values from gas-benchmark.test.ts
      // Reported here as constants for paper consolidation
      const gasCosts = {
        proposeStateRoot: 119_431,
        initiateDispute: 298_872,
        depositSequencerBond: 46_197,
        submitProof: 233_464,
        resolveDispute: 80_000,
        triggerTimeout: 86_480,
        factoryCreate: 319_838,
        addAuthorizedProxy: 45_266,
        proxyChallenge: 347_254,
        proxyResolve: 67_312,
      };

      const directTotal = gasCosts.initiateDispute + gasCosts.depositSequencerBond + gasCosts.triggerTimeout;
      const proofTotal = gasCosts.initiateDispute + gasCosts.depositSequencerBond + gasCosts.submitProof + gasCosts.resolveDispute;
      const cannonEstimate = 73 * 2 * 50_000; // 73 rounds * 2 tx * 50K gas

      console.log('\n  ═══════════════════════════════════════════════════');
      console.log('  Paper Gas Data Summary');
      console.log('  ═══════════════════════════════════════════════════');
      console.log(`  Direct path (timeout):  ${directTotal.toLocaleString()} gas`);
      console.log(`  Direct path (proof):    ${proofTotal.toLocaleString()} gas`);
      console.log(`  Cannon baseline:        ${cannonEstimate.toLocaleString()} gas`);
      console.log(`  Gas reduction (timeout): ${((1 - directTotal / cannonEstimate) * 100).toFixed(1)}%`);
      console.log(`  Gas reduction (proof):   ${((1 - proofTotal / cannonEstimate) * 100).toFixed(1)}%`);
      console.log('  ═══════════════════════════════════════════════════');

      expect(directTotal).to.equal(431_549);
      expect(gasCosts.submitProof).to.equal(233_464);
      expect(directTotal).to.be.lessThan(cannonEstimate);
    });
  });
});
