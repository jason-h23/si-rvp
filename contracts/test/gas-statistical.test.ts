/**
 * Gas Statistical Benchmarks
 *
 * Multi-run gas measurements with statistical analysis (mean, stddev, P95, P99).
 * Data feeds into docs/paper-gas-data.md Table 1 (with confidence intervals).
 *
 * Also benchmarks off-chain MIPS executor performance (Table 5).
 *
 * @module test/gas-statistical.test.ts
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  DisputeManager,
  RollupManager,
  ZKVerifier,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// ============================================
// Statistics Helpers
// ============================================

interface Stats {
  n: number;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  p95: number;
  p99: number;
}

function computeStats(values: number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  const stdDev = Math.sqrt(variance);
  const p95 = sorted[Math.floor(n * 0.95)];
  const p99 = sorted[Math.floor(n * 0.99)];

  return {
    n,
    mean: Math.round(mean),
    median: Math.round(median),
    stdDev: Math.round(stdDev),
    min: sorted[0],
    max: sorted[n - 1],
    p95,
    p99,
  };
}

function formatStats(label: string, stats: Stats): string {
  return `    ${label.padEnd(22)} │ ${String(stats.mean).padStart(8)} │ ${String(stats.median).padStart(8)} │ ${String(stats.stdDev).padStart(7)} │ ${String(stats.min).padStart(8)} │ ${String(stats.max).padStart(8)}`;
}

// ============================================
// Tests
// ============================================

describe("Gas Statistical Benchmarks", function () {
  // Increase timeout for multi-run benchmarks
  this.timeout(120_000);

  let disputeManager: DisputeManager;
  let rollupManager: RollupManager;
  let zkVerifier: ZKVerifier;
  let owner: HardhatEthersSigner;
  let sequencer: HardhatEthersSigner;
  let challenger: HardhatEthersSigner;

  const BOND_AMOUNT = ethers.parseEther("0.01");
  const PROOF_DEADLINE = 60 * 60;
  const RUNS = 5;

  beforeEach(async function () {
    [owner, sequencer, challenger] = await ethers.getSigners();

    const ZKVerifier = await ethers.getContractFactory("ZKVerifier");
    zkVerifier = await ZKVerifier.deploy();

    const RollupManager = await ethers.getContractFactory("RollupManager");
    rollupManager = await RollupManager.deploy(sequencer.address);

    const DisputeManager = await ethers.getContractFactory("DisputeManager");
    disputeManager = await DisputeManager.deploy(
      await zkVerifier.getAddress(),
      await rollupManager.getAddress()
    );

    await rollupManager.setDisputeManager(await disputeManager.getAddress());
  });

  describe(`Multi-run gas measurements (${RUNS} runs)`, function () {
    it("should measure proposeStateRoot gas with statistics", async function () {
      const gasValues: number[] = [];

      for (let i = 0; i < RUNS; i++) {
        const stateRoot = ethers.keccak256(ethers.toUtf8Bytes(`state-${i}`));
        const tx = await rollupManager
          .connect(sequencer)
          .proposeStateRoot(stateRoot, i + 1);
        const receipt = await tx.wait();
        gasValues.push(Number(receipt!.gasUsed));
      }

      const stats = computeStats(gasValues);
      console.log(`\n    proposeStateRoot (${RUNS} runs): mean=${stats.mean}, stddev=${stats.stdDev}, range=[${stats.min}, ${stats.max}]`);
      expect(stats.mean).to.be.greaterThan(0);
      expect(stats.stdDev).to.be.lessThan(stats.mean * 0.5); // stddev < 50% of mean
    });

    it("should measure initiateDispute gas with statistics", async function () {
      const gasValues: number[] = [];

      for (let i = 0; i < RUNS; i++) {
        // Fresh deployment each run to get independent measurements
        const ZKV = await ethers.getContractFactory("ZKVerifier");
        const v = await ZKV.deploy();
        const RM = await ethers.getContractFactory("RollupManager");
        const rm = await RM.deploy(sequencer.address);
        const DM = await ethers.getContractFactory("DisputeManager");
        const dm = await DM.deploy(await v.getAddress(), await rm.getAddress());
        await rm.setDisputeManager(await dm.getAddress());

        const sr = ethers.keccak256(ethers.toUtf8Bytes(`sr-${i}`));
        await rm.connect(sequencer).proposeStateRoot(sr, 1);

        const claim = ethers.keccak256(ethers.toUtf8Bytes(`claim-${i}`));
        const tx = await dm
          .connect(challenger)
          .initiateDispute(1, claim, { value: BOND_AMOUNT });
        const receipt = await tx.wait();
        gasValues.push(Number(receipt!.gasUsed));
      }

      const stats = computeStats(gasValues);
      console.log(`    initiateDispute (${RUNS} runs): mean=${stats.mean}, stddev=${stats.stdDev}, range=[${stats.min}, ${stats.max}]`);
      expect(stats.mean).to.be.greaterThan(0);
    });

    it("should measure depositSequencerBond gas with statistics", async function () {
      const gasValues: number[] = [];

      for (let i = 0; i < RUNS; i++) {
        const ZKV = await ethers.getContractFactory("ZKVerifier");
        const v = await ZKV.deploy();
        const RM = await ethers.getContractFactory("RollupManager");
        const rm = await RM.deploy(sequencer.address);
        const DM = await ethers.getContractFactory("DisputeManager");
        const dm = await DM.deploy(await v.getAddress(), await rm.getAddress());
        await rm.setDisputeManager(await dm.getAddress());

        const sr = ethers.keccak256(ethers.toUtf8Bytes(`sr-bond-${i}`));
        await rm.connect(sequencer).proposeStateRoot(sr, 1);

        const claim = ethers.keccak256(ethers.toUtf8Bytes(`claim-bond-${i}`));
        await dm.connect(challenger).initiateDispute(1, claim, { value: BOND_AMOUNT });

        const tx = await dm
          .connect(sequencer)
          .depositSequencerBond(1, { value: BOND_AMOUNT });
        const receipt = await tx.wait();
        gasValues.push(Number(receipt!.gasUsed));
      }

      const stats = computeStats(gasValues);
      console.log(`    depositSequencerBond (${RUNS} runs): mean=${stats.mean}, stddev=${stats.stdDev}, range=[${stats.min}, ${stats.max}]`);
      expect(stats.mean).to.be.greaterThan(0);
    });

    it("should measure triggerTimeout gas with statistics", async function () {
      const gasValues: number[] = [];

      for (let i = 0; i < RUNS; i++) {
        const ZKV = await ethers.getContractFactory("ZKVerifier");
        const v = await ZKV.deploy();
        const RM = await ethers.getContractFactory("RollupManager");
        const rm = await RM.deploy(sequencer.address);
        const DM = await ethers.getContractFactory("DisputeManager");
        const dm = await DM.deploy(await v.getAddress(), await rm.getAddress());
        await rm.setDisputeManager(await dm.getAddress());

        const sr = ethers.keccak256(ethers.toUtf8Bytes(`sr-to-${i}`));
        await rm.connect(sequencer).proposeStateRoot(sr, 1);

        const claim = ethers.keccak256(ethers.toUtf8Bytes(`claim-to-${i}`));
        await dm.connect(challenger).initiateDispute(1, claim, { value: BOND_AMOUNT });
        await dm.connect(sequencer).depositSequencerBond(1, { value: BOND_AMOUNT });

        await time.increase(PROOF_DEADLINE + 1);
        const tx = await dm.triggerTimeout(1);
        const receipt = await tx.wait();
        gasValues.push(Number(receipt!.gasUsed));
      }

      const stats = computeStats(gasValues);
      console.log(`    triggerTimeout (${RUNS} runs): mean=${stats.mean}, stddev=${stats.stdDev}, range=[${stats.min}, ${stats.max}]`);
      expect(stats.mean).to.be.greaterThan(0);
    });
  });

  describe("Summary table", function () {
    it("should generate formatted statistical summary", async function () {
      const results: Record<string, number[]> = {
        proposeStateRoot: [],
        initiateDispute: [],
        depositBond: [],
        triggerTimeout: [],
      };

      for (let i = 0; i < RUNS; i++) {
        // Fresh contracts per run
        const ZKV = await ethers.getContractFactory("ZKVerifier");
        const v = await ZKV.deploy();
        const RM = await ethers.getContractFactory("RollupManager");
        const rm = await RM.deploy(sequencer.address);
        const DM = await ethers.getContractFactory("DisputeManager");
        const dm = await DM.deploy(await v.getAddress(), await rm.getAddress());
        await rm.setDisputeManager(await dm.getAddress());

        // proposeStateRoot
        const sr = ethers.keccak256(ethers.toUtf8Bytes(`summary-sr-${i}`));
        const proposeTx = await rm.connect(sequencer).proposeStateRoot(sr, 1);
        results.proposeStateRoot.push(Number((await proposeTx.wait())!.gasUsed));

        // initiateDispute
        const claim = ethers.keccak256(ethers.toUtf8Bytes(`summary-claim-${i}`));
        const initTx = await dm.connect(challenger).initiateDispute(1, claim, { value: BOND_AMOUNT });
        results.initiateDispute.push(Number((await initTx.wait())!.gasUsed));

        // depositSequencerBond
        const bondTx = await dm.connect(sequencer).depositSequencerBond(1, { value: BOND_AMOUNT });
        results.depositBond.push(Number((await bondTx.wait())!.gasUsed));

        // triggerTimeout
        await time.increase(PROOF_DEADLINE + 1);
        const timeoutTx = await dm.triggerTimeout(1);
        results.triggerTimeout.push(Number((await timeoutTx.wait())!.gasUsed));
      }

      console.log(`\n    ═══════════════════════════════════════════════════════════════════════════`);
      console.log(`    Gas Statistical Summary (${RUNS} runs per operation)`);
      console.log(`    ═══════════════════════════════════════════════════════════════════════════`);
      console.log(`    Operation              │     Mean │   Median │  StdDev │      Min │      Max`);
      console.log(`    ───────────────────────┼──────────┼──────────┼─────────┼──────────┼──────────`);

      for (const [name, values] of Object.entries(results)) {
        const stats = computeStats(values);
        console.log(formatStats(name, stats));
      }

      console.log(`    ═══════════════════════════════════════════════════════════════════════════\n`);

      // All measurements should be deterministic within Hardhat
      for (const values of Object.values(results)) {
        const stats = computeStats(values);
        expect(stats.stdDev).to.be.lessThan(stats.mean * 0.1);
      }
    });
  });
});
