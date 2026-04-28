/**
 * Gas Benchmark: ZKDisputeGameProxy vs Direct DisputeManager
 *
 * Compares gas costs between:
 * 1. Factory → Proxy → DisputeManager path (Optimism-compatible)
 * 2. Direct DisputeManager path (current SI-RVP)
 *
 * This data feeds into the SI-RVP paper's gas analysis section.
 *
 * @module test/gas-benchmark.test.ts
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  DisputeGameFactory,
  ZKDisputeGameProxy,
  DisputeManager,
  RollupManager,
  ZKVerifier,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Gas Benchmark: Factory Path vs Direct Path", function () {
  let factory: DisputeGameFactory;
  let proxyImpl: ZKDisputeGameProxy;
  let disputeManager: DisputeManager;
  let rollupManager: RollupManager;
  let zkVerifier: ZKVerifier;
  let owner: HardhatEthersSigner;
  let sequencer: HardhatEthersSigner;
  let challenger: HardhatEthersSigner;

  const BOND_AMOUNT = ethers.parseEther("0.01");
  const PROOF_DEADLINE = 60 * 60;
  const ZK_CANNON = 255;

  const stateRoot1 = ethers.keccak256(ethers.toUtf8Bytes("state1"));
  const stateRoot2 = ethers.keccak256(ethers.toUtf8Bytes("state2"));

  beforeEach(async function () {
    [owner, sequencer, challenger] = await ethers.getSigners();

    // Deploy core contracts
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

    // Deploy factory + proxy implementation
    const Factory = await ethers.getContractFactory("DisputeGameFactory");
    factory = await Factory.deploy();

    const Proxy = await ethers.getContractFactory("ZKDisputeGameProxy");
    proxyImpl = await Proxy.deploy();

    await factory.setImplementation(ZK_CANNON, await proxyImpl.getAddress());
  });

  describe("Deployment Gas", function () {
    it("should measure contract deployment costs", async function () {
      // Fresh deployments for gas measurement
      const ZKVerifierFactory = await ethers.getContractFactory("ZKVerifier");
      const verifierTx = await ZKVerifierFactory.deploy();
      const verifierReceipt = await verifierTx.deploymentTransaction()?.wait();

      const RollupManagerFactory = await ethers.getContractFactory("RollupManager");
      const rollupTx = await RollupManagerFactory.deploy(sequencer.address);
      const rollupReceipt = await rollupTx.deploymentTransaction()?.wait();

      const DisputeManagerFactory = await ethers.getContractFactory("DisputeManager");
      const dmTx = await DisputeManagerFactory.deploy(
        await verifierTx.getAddress(),
        await rollupTx.getAddress()
      );
      const dmReceipt = await dmTx.deploymentTransaction()?.wait();

      const FactoryFactory = await ethers.getContractFactory("DisputeGameFactory");
      const factoryTx = await FactoryFactory.deploy();
      const factoryReceipt = await factoryTx.deploymentTransaction()?.wait();

      const ProxyFactory = await ethers.getContractFactory("ZKDisputeGameProxy");
      const proxyTx = await ProxyFactory.deploy();
      const proxyReceipt = await proxyTx.deploymentTransaction()?.wait();

      console.log("\n  ═══════════════════════════════════════════════");
      console.log("  Deployment Gas Costs");
      console.log("  ═══════════════════════════════════════════════");
      console.log(`  ZKVerifier:           ${verifierReceipt!.gasUsed.toString().padStart(10)} gas`);
      console.log(`  RollupManager:        ${rollupReceipt!.gasUsed.toString().padStart(10)} gas`);
      console.log(`  DisputeManager:       ${dmReceipt!.gasUsed.toString().padStart(10)} gas`);
      console.log(`  DisputeGameFactory:   ${factoryReceipt!.gasUsed.toString().padStart(10)} gas`);
      console.log(`  ZKDisputeGameProxy:   ${proxyReceipt!.gasUsed.toString().padStart(10)} gas`);
      console.log(`  ───────────────────────────────────────────────`);
      console.log(`  Phase 7 overhead:     ${(factoryReceipt!.gasUsed + proxyReceipt!.gasUsed).toString().padStart(10)} gas`);
    });
  });

  describe("Direct Path (Current SI-RVP)", function () {
    it("should measure direct dispute lifecycle gas", async function () {
      await rollupManager.connect(sequencer).proposeStateRoot(stateRoot1, 1);

      // Initiate dispute directly
      const initTx = await disputeManager
        .connect(challenger)
        .initiateDispute(1, stateRoot2, { value: BOND_AMOUNT });
      const initReceipt = await initTx.wait();

      // Deposit sequencer bond
      const bondTx = await disputeManager
        .connect(sequencer)
        .depositSequencerBond(1, { value: BOND_AMOUNT });
      const bondReceipt = await bondTx.wait();

      // Timeout and resolve
      await time.increase(PROOF_DEADLINE + 1);
      const timeoutTx = await disputeManager.triggerTimeout(1);
      const timeoutReceipt = await timeoutTx.wait();

      console.log("\n  ═══════════════════════════════════════════════");
      console.log("  Direct Path Gas Costs");
      console.log("  ═══════════════════════════════════════════════");
      console.log(`  initiateDispute():    ${initReceipt!.gasUsed.toString().padStart(10)} gas`);
      console.log(`  depositSequencerBond: ${bondReceipt!.gasUsed.toString().padStart(10)} gas`);
      console.log(`  triggerTimeout():     ${timeoutReceipt!.gasUsed.toString().padStart(10)} gas`);
      console.log(`  ───────────────────────────────────────────────`);
      console.log(`  Total:                ${(initReceipt!.gasUsed + bondReceipt!.gasUsed + timeoutReceipt!.gasUsed).toString().padStart(10)} gas`);
    });
  });

  describe("Factory Path (Phase 7 Optimism-compatible)", function () {
    it("should measure factory dispute lifecycle gas", async function () {
      await rollupManager.connect(sequencer).proposeStateRoot(stateRoot1, 1);

      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [1, await disputeManager.getAddress()]
      );

      // Create game via factory
      const createTx = await factory.create(ZK_CANNON, stateRoot1, 100, extraData);
      const createReceipt = await createTx.wait();

      const gameAddr = await factory.gameAtIdx(0);
      const game = await ethers.getContractAt("ZKDisputeGameProxy", gameAddr);

      // Authorize clone
      const authTx = await disputeManager.addAuthorizedProxy(gameAddr);
      const authReceipt = await authTx.wait();

      // Challenge via proxy
      const challengeTx = await game
        .connect(challenger)
        .challenge(stateRoot2, { value: BOND_AMOUNT });
      const challengeReceipt = await challengeTx.wait();

      // Deposit sequencer bond (still direct to DisputeManager)
      const bondTx = await disputeManager
        .connect(sequencer)
        .depositSequencerBond(1, { value: BOND_AMOUNT });
      const bondReceipt = await bondTx.wait();

      // Timeout
      await time.increase(PROOF_DEADLINE + 1);
      const timeoutTx = await disputeManager.triggerTimeout(1);
      const timeoutReceipt = await timeoutTx.wait();

      // Resolve via proxy
      const resolveTx = await game.resolve();
      const resolveReceipt = await resolveTx.wait();

      console.log("\n  ═══════════════════════════════════════════════");
      console.log("  Factory Path Gas Costs");
      console.log("  ═══════════════════════════════════════════════");
      console.log(`  Factory.create():     ${createReceipt!.gasUsed.toString().padStart(10)} gas`);
      console.log(`  addAuthorizedProxy(): ${authReceipt!.gasUsed.toString().padStart(10)} gas`);
      console.log(`  Proxy.challenge():    ${challengeReceipt!.gasUsed.toString().padStart(10)} gas`);
      console.log(`  depositSequencerBond: ${bondReceipt!.gasUsed.toString().padStart(10)} gas`);
      console.log(`  triggerTimeout():     ${timeoutReceipt!.gasUsed.toString().padStart(10)} gas`);
      console.log(`  Proxy.resolve():      ${resolveReceipt!.gasUsed.toString().padStart(10)} gas`);
      console.log(`  ───────────────────────────────────────────────`);

      const factoryTotal = createReceipt!.gasUsed + authReceipt!.gasUsed +
        challengeReceipt!.gasUsed + bondReceipt!.gasUsed +
        timeoutReceipt!.gasUsed + resolveReceipt!.gasUsed;
      console.log(`  Total:                ${factoryTotal.toString().padStart(10)} gas`);
    });
  });

  describe("Comparison Summary", function () {
    it("should generate comparison table", async function () {
      await rollupManager.connect(sequencer).proposeStateRoot(stateRoot1, 1);

      // === Direct path ===
      const directInitTx = await disputeManager
        .connect(challenger)
        .initiateDispute(1, stateRoot2, { value: BOND_AMOUNT });
      const directInitGas = (await directInitTx.wait())!.gasUsed;

      await time.increase(PROOF_DEADLINE + 1);
      const directTimeoutTx = await disputeManager.triggerTimeout(1);
      const directTimeoutGas = (await directTimeoutTx.wait())!.gasUsed;

      // === Factory path (new batch for fresh dispute) ===
      await rollupManager.connect(sequencer).proposeStateRoot(stateRoot2, 2);

      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address"],
        [2, await disputeManager.getAddress()]
      );

      const createTx = await factory.create(ZK_CANNON, stateRoot2, 100, extraData);
      const createGas = (await createTx.wait())!.gasUsed;

      const gameAddr = await factory.gameAtIdx(0);
      const game = await ethers.getContractAt("ZKDisputeGameProxy", gameAddr);
      await disputeManager.addAuthorizedProxy(gameAddr);

      const challengeRoot = ethers.keccak256(ethers.toUtf8Bytes("state3"));
      const challengeTx = await game
        .connect(challenger)
        .challenge(challengeRoot, { value: BOND_AMOUNT });
      const challengeGas = (await challengeTx.wait())!.gasUsed;

      await time.increase(PROOF_DEADLINE + 1);
      await disputeManager.triggerTimeout(2);

      const resolveTx = await game.resolve();
      const resolveGas = (await resolveTx.wait())!.gasUsed;

      // Proxy overhead = challenge_via_proxy - direct_initiate
      const proxyOverhead = challengeGas - directInitGas;

      console.log("\n  ═══════════════════════════════════════════════════════");
      console.log("  Gas Comparison: Direct vs Factory Path");
      console.log("  ═══════════════════════════════════════════════════════");
      console.log("  Operation             │   Direct  │  Factory  │ Overhead");
      console.log("  ──────────────────────┼───────────┼───────────┼─────────");
      console.log(`  Initiate/Challenge    │ ${directInitGas.toString().padStart(9)} │ ${challengeGas.toString().padStart(9)} │ ${proxyOverhead > 0n ? '+' : ''}${proxyOverhead.toString()}`);
      console.log(`  Factory.create()      │       N/A │ ${createGas.toString().padStart(9)} │ (one-time)`);
      console.log(`  Resolve               │ ${directTimeoutGas.toString().padStart(9)} │ ${resolveGas.toString().padStart(9)} │ ${(resolveGas - directTimeoutGas) > 0n ? '+' : ''}${(resolveGas - directTimeoutGas).toString()}`);
      console.log("  ═══════════════════════════════════════════════════════");
      console.log(`\n  Key insight: Proxy adds ~${proxyOverhead} gas overhead per challenge`);
      console.log(`  This is ${((Number(proxyOverhead) / Number(directInitGas)) * 100).toFixed(1)}% overhead vs direct path`);
      console.log(`  Factory.create() is a one-time cost per game instance\n`);

      // Proxy overhead should be reasonable (< 100K gas)
      expect(proxyOverhead).to.be.lt(100_000n);
    });
  });
});
