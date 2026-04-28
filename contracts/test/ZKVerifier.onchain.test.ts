/**
 * On-chain ZK Proof Verification Test
 *
 * Generates ZK proofs in real-time via snarkjs and verifies them on-chain.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
// @ts-ignore - snarkjs has no type declarations
import * as snarkjs from "snarkjs";

// Import from node package (relative to contracts/test/)
const nodeSrc = path.join(__dirname, "../../node/src");

describe("ZKVerifier On-chain Verification", function () {
  this.timeout(120000);

  let zkVerifier: any;
  let proof: any;
  let publicSignals: string[];

  before(async function () {
    // Check circuit files
    const circuitWasm = path.join(__dirname, "../../circuits/build/mips_single_step_js/mips_single_step.wasm");
    const circuitZkey = path.join(__dirname, "../../circuits/build/mips_single_step_final.zkey");

    if (!fs.existsSync(circuitWasm) || !fs.existsSync(circuitZkey)) {
      console.log("Circuit build files not found. Build circuits first:");
      console.log("  cd circuits && npm run build");
      this.skip();
      return;
    }

    // Require node modules (ts-node registered by Hardhat)
    const { MipsExecutor, MipsInstructionBuilder } = require(path.join(nodeSrc, "common/mips.ts"));
    const { PoseidonHasher } = require(path.join(nodeSrc, "common/prover.ts"));

    // Execute a simple MIPS program
    const mipsExecutor = new MipsExecutor();
    const instructions: bigint[] = [
      MipsInstructionBuilder.addi(1, 0, 42),  // r1 = 42
      MipsInstructionBuilder.addi(2, 0, 58),  // r2 = 58
      MipsInstructionBuilder.add(3, 1, 2),    // r3 = r1 + r2 = 100
    ];

    let state = MipsExecutor.createInitialState();
    const states = [{ ...state, registers: [...state.registers] }];
    for (const inst of instructions) {
      state = mipsExecutor.executeStep(state, inst);
      states.push({ ...state, registers: [...state.registers] });
    }

    // Generate proof for step 0 -> step 1 transition
    const preState = states[0];
    const postState = states[1];
    const instruction = instructions[0];

    // Initialize PoseidonHasher for circuit-compatible state hashing
    const poseidon = new PoseidonHasher();
    await poseidon.initialize();

    const preStateHash = poseidon.hashMipsState(preState);
    const postStateHash = poseidon.hashMipsState(postState);

    // Build circuit input
    const circuitInput = {
      preStateHash: preStateHash.toString(),
      postStateHash: postStateHash.toString(),
      prePC: preState.pc.toString(),
      preNextPC: preState.nextPC.toString(),
      preRegisters: preState.registers.map((r: bigint) => r.toString()),
      preHi: preState.hi.toString(),
      preLo: preState.lo.toString(),
      preMemoryRoot: preState.memoryRoot.toString(),
      preStep: preState.step.toString(),
      instruction: instruction.toString(),
      memAddress: "0",
      memValue: "0",
      memProof: Array(20).fill("0"),
      postPC: postState.pc.toString(),
      postNextPC: postState.nextPC.toString(),
      postRegisters: postState.registers.map((r: bigint) => r.toString()),
      postHi: postState.hi.toString(),
      postLo: postState.lo.toString(),
      postMemoryRoot: postState.memoryRoot.toString(),
      postStep: postState.step.toString(),
    };

    // Generate proof in real-time
    console.log("Generating ZK proof via snarkjs.groth16.fullProve()...");
    const proofStart = Date.now();
    const result = await snarkjs.groth16.fullProve(circuitInput, circuitWasm, circuitZkey);
    const proofTime = Date.now() - proofStart;
    console.log(`Proof generated in ${proofTime}ms`);

    proof = result.proof;
    publicSignals = result.publicSignals;
    console.log("Public signals:", publicSignals.map((s: string) => s.slice(0, 15) + "..."));

    // Deploy ZKVerifier
    const ZKVerifier = await ethers.getContractFactory("ZKVerifier");
    zkVerifier = await ZKVerifier.deploy();
    await zkVerifier.waitForDeployment();

    console.log("ZKVerifier deployed to:", await zkVerifier.getAddress());
  });

  describe("Proof Verification", function () {
    it("should verify valid proof on-chain", async function () {
      // Proof conversion (snarkjs format -> Solidity format)
      // a: G1 point [x, y]
      const a: [bigint, bigint] = [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])];

      // b: G2 point [[x1, x2], [y1, y2]] - Note: snarkjs reverses the order
      const b: [[bigint, bigint], [bigint, bigint]] = [
        [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
        [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
      ];

      // c: G1 point [x, y]
      const c: [bigint, bigint] = [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])];

      // public signals
      const pubSignals: [bigint, bigint, bigint] = [
        BigInt(publicSignals[0]),
        BigInt(publicSignals[1]),
        BigInt(publicSignals[2]),
      ];

      console.log("\n=== On-chain Verification Test ===");
      console.log("Public signals:", publicSignals);

      // Verification (view function)
      const isValid = await zkVerifier.verifyProofFixed(a, b, c, pubSignals);
      console.log("Verification result:", isValid);

      expect(isValid).to.be.true;
    });

    it("should measure gas cost for verification", async function () {
      const a: [bigint, bigint] = [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])];
      const b: [[bigint, bigint], [bigint, bigint]] = [
        [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
        [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
      ];
      const c: [bigint, bigint] = [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])];
      const pubSignals: [bigint, bigint, bigint] = [
        BigInt(publicSignals[0]),
        BigInt(publicSignals[1]),
        BigInt(publicSignals[2]),
      ];

      // Gas estimation
      const gasEstimate = await zkVerifier.verifyProofFixed.estimateGas(a, b, c, pubSignals);

      console.log("\n=== Gas Cost Analysis ===");
      console.log("Estimated gas:", gasEstimate.toString());

      // Calculate ETH cost (assuming gas prices)
      const gasPrices = [
        { name: "Low (10 Gwei)", gwei: 10n },
        { name: "Medium (30 Gwei)", gwei: 30n },
        { name: "High (50 Gwei)", gwei: 50n },
        { name: "Very High (100 Gwei)", gwei: 100n },
      ];

      console.log("\nCost at different gas prices (ETH = $3000):");
      for (const { name, gwei } of gasPrices) {
        const costWei = gasEstimate * gwei * 1000000000n;
        const costEth = Number(costWei) / 1e18;
        const costUsd = costEth * 3000;
        console.log(`  ${name}: ${costEth.toFixed(6)} ETH ($${costUsd.toFixed(2)})`);
      }

      // Compare with paper claims
      console.log("\n=== Comparison with Paper Claims ===");
      console.log(`Measured gas:    ${gasEstimate.toString()}`);
      console.log(`Paper claim:     ~280,000 gas`);

      const diff = ((Number(gasEstimate) / 280000 - 1) * 100);
      console.log(`Difference:      ${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`);

      expect(Number(gasEstimate)).to.be.lessThan(400000); // within 400K
    });

    it("should reject invalid proof", async function () {
      // Invalid proof (modify pi_a[0])
      const a: [bigint, bigint] = [BigInt(12345678901234567890n), BigInt(proof.pi_a[1])];
      const b: [[bigint, bigint], [bigint, bigint]] = [
        [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
        [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
      ];
      const c: [bigint, bigint] = [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])];
      const pubSignals: [bigint, bigint, bigint] = [
        BigInt(publicSignals[0]),
        BigInt(publicSignals[1]),
        BigInt(publicSignals[2]),
      ];

      console.log("\n=== Invalid Proof Test ===");

      const isValid = await zkVerifier.verifyProofFixed(a, b, c, pubSignals);
      console.log("Verification result for invalid proof:", isValid);

      expect(isValid).to.be.false;
    });
  });

  describe("Full Dispute Flow Gas Costs", function () {
    it("should measure total dispute resolution gas", async function () {
      const a: [bigint, bigint] = [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])];
      const b: [[bigint, bigint], [bigint, bigint]] = [
        [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
        [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
      ];
      const c: [bigint, bigint] = [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])];
      const pubSignals: [bigint, bigint, bigint] = [
        BigInt(publicSignals[0]),
        BigInt(publicSignals[1]),
        BigInt(publicSignals[2]),
      ];

      // Deploy RollupManager and DisputeManager
      const RollupManager = await ethers.getContractFactory("RollupManager");
      const [deployer, sequencer, challenger] = await ethers.getSigners();

      const rollupManager = await RollupManager.deploy(sequencer.address);
      await rollupManager.waitForDeployment();

      const DisputeManager = await ethers.getContractFactory("DisputeManager");
      const disputeManager = await DisputeManager.deploy(
        await zkVerifier.getAddress(),
        await rollupManager.getAddress()
      );
      await disputeManager.waitForDeployment();

      // Configure DisputeManager
      await rollupManager.setDisputeManager(await disputeManager.getAddress());

      // Submit batch
      const stateRoot = ethers.keccak256(ethers.toUtf8Bytes("state_root_1"));
      await rollupManager.connect(sequencer).proposeStateRoot(stateRoot, 1);

      console.log("\n=== Full Dispute Flow Gas Costs ===");

      // 1. Initiate dispute
      const challengerClaim = ethers.keccak256(ethers.toUtf8Bytes("challenger_claim"));
      const initiateTx = await disputeManager.connect(challenger).initiateDispute(1, challengerClaim, {
        value: ethers.parseEther("0.01"),
      });
      const initiateReceipt = await initiateTx.wait();
      console.log("1. initiateDispute gas:", initiateReceipt?.gasUsed.toString());

      // 2. Deposit sequencer bond
      const depositTx = await disputeManager.connect(sequencer).depositSequencerBond(1, {
        value: ethers.parseEther("0.01"),
      });
      const depositReceipt = await depositTx.wait();
      console.log("2. depositSequencerBond gas:", depositReceipt?.gasUsed.toString());

      // 3. ZK verification gas
      const zkVerifyGas = await zkVerifier.verifyProofFixed.estimateGas(a, b, c, pubSignals);
      console.log("3. ZK verification gas:", zkVerifyGas.toString());

      // Calculate total gas cost
      const totalGas =
        BigInt(initiateReceipt?.gasUsed || 0) +
        BigInt(depositReceipt?.gasUsed || 0) +
        BigInt(zkVerifyGas);

      console.log("─".repeat(40));
      console.log("Total dispute gas:", totalGas.toString());

      // Cost calculation
      const calculateCost = (gas: bigint, gweiPrice: bigint, ethPrice: number) => {
        const costWei = gas * gweiPrice * 1000000000n;
        const costEth = Number(costWei) / 1e18;
        return { eth: costEth, usd: costEth * ethPrice };
      };

      // Paper conditions: 50 Gwei, ETH = $2400 (at time of paper writing)
      const paperCost = calculateCost(totalGas, 50n, 2400);
      // Current conditions: 30 Gwei, ETH = $3000
      const currentCost = calculateCost(totalGas, 30n, 3000);

      console.log(`\n=== Cost Comparison ===`);
      console.log(`Paper conditions (50 Gwei, ETH=$2400):`);
      console.log(`  ${paperCost.eth.toFixed(6)} ETH = $${paperCost.usd.toFixed(2)}`);
      console.log(`Current conditions (30 Gwei, ETH=$3000):`);
      console.log(`  ${currentCost.eth.toFixed(6)} ETH = $${currentCost.usd.toFixed(2)}`);

      console.log("\n=== Paper Claim Comparison ===");
      console.log("Paper claims: $61.34 (350,000 gas @ 50 Gwei)");
      console.log(`Measured:     $${paperCost.usd.toFixed(2)} (${totalGas} gas @ 50 Gwei)`);

      const paperGasClaim = 350000n;
      const gasRatio = (Number(totalGas) / Number(paperGasClaim) * 100).toFixed(1);
      console.log(`Gas ratio:    ${gasRatio}% of paper claim`);
    });
  });
});
