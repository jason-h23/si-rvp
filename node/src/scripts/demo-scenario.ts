/**
 * SI-RVP - Demo Scenario Script
 *
 * Comprehensive demonstration of the dispute protocol
 * with multiple scenarios and metrics collection.
 */

import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
// @ts-ignore - snarkjs has no type declarations
import * as snarkjs from 'snarkjs';
import { MipsExecutor, MipsInstructionBuilder } from '../common/mips';
import { MipsState } from '../common/types';
import { BisectionProtocol, ChannelManager } from '../common/bisection';
import { hashMipsStateKeccak } from '../common/hash';
import { PoseidonHasher } from '../common/prover';
import { MetricsCollector } from '../metrics';

// Circuit paths
const CIRCUIT_WASM = path.join(__dirname, '../../../circuits/build/mips_single_step_js/mips_single_step.wasm');
const CIRCUIT_ZKEY = path.join(__dirname, '../../../circuits/build/mips_single_step_final.zkey');
const CIRCUIT_VKEY = path.join(__dirname, '../../../circuits/build/verification_key.json');

// ============================================
// Demo Configuration
// ============================================
const SCENARIOS = {
  HAPPY_PATH: 'happy_path',
  DISPUTE_EARLY: 'dispute_early',
  DISPUTE_LATE: 'dispute_late',
  TIMEOUT: 'timeout',
} as const;

type ScenarioType = typeof SCENARIOS[keyof typeof SCENARIOS];

// ============================================
// Program Generator
// ============================================
function generateTestProgram(size: number): bigint[] {
  const instructions: bigint[] = [];

  // Initialize registers
  instructions.push(MipsInstructionBuilder.addi(1, 0, 100));
  instructions.push(MipsInstructionBuilder.addi(2, 0, 50));

  // Generate computational instructions
  for (let i = 0; i < size - 2; i++) {
    const op = i % 5;
    switch (op) {
      case 0:
        instructions.push(MipsInstructionBuilder.add(3 + (i % 25), 1, 2));
        break;
      case 1:
        instructions.push(MipsInstructionBuilder.sub(3 + (i % 25), 1, 2));
        break;
      case 2:
        instructions.push(MipsInstructionBuilder.and(3 + (i % 25), 1, 2));
        break;
      case 3:
        instructions.push(MipsInstructionBuilder.or(3 + (i % 25), 1, 2));
        break;
      case 4:
        instructions.push(MipsInstructionBuilder.slt(3 + (i % 25), 2, 1));
        break;
    }
  }

  return instructions;
}

// ============================================
// Scenario Executor
// ============================================
async function runScenario(
  scenario: ScenarioType,
  programSize: number = 20
): Promise<void> {
  const metrics = new MetricsCollector();
  const mipsExecutor = new MipsExecutor();
  const bisectionProtocol = new BisectionProtocol();
  const channelManager = new ChannelManager();

  const sequencerWallet = ethers.Wallet.createRandom();
  const challengerWallet = ethers.Wallet.createRandom();

  const instructions = generateTestProgram(programSize);

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`SCENARIO: ${scenario.toUpperCase()}`);
  console.log(`Program Size: ${programSize} instructions`);
  console.log(`${'═'.repeat(70)}\n`);

  metrics.startTimer('totalScenario');

  // ============================================
  // Step 1: Sequencer Execution
  // ============================================
  console.log('Step 1: Sequencer Execution');
  console.log('─'.repeat(50));

  let sequencerState = MipsExecutor.createInitialState();
  const sequencerHistory: Map<bigint, MipsState> = new Map();
  sequencerHistory.set(0n, { ...sequencerState, registers: [...sequencerState.registers] });

  metrics.startTimer('sequencerExecution');
  for (const instruction of instructions) {
    sequencerState = mipsExecutor.executeStep(sequencerState, instruction);
    sequencerHistory.set(sequencerState.step, { ...sequencerState, registers: [...sequencerState.registers] });
  }
  const seqExecTime = metrics.stopTimer('sequencerExecution');

  console.log(`  Executed ${instructions.length} instructions`);
  console.log(`  Final PC: ${sequencerState.pc}`);
  console.log(`  Final Step: ${sequencerState.step}`);
  console.log(`  Execution time: ${seqExecTime}ms`);
  console.log();

  // ============================================
  // Step 2: Challenger Execution
  // ============================================
  console.log('Step 2: Challenger Execution');
  console.log('─'.repeat(50));

  let challengerState = MipsExecutor.createInitialState();
  const challengerHistory: Map<bigint, MipsState> = new Map();
  challengerHistory.set(0n, { ...challengerState, registers: [...challengerState.registers] });

  // Determine discrepancy point based on scenario
  let discrepancyStep = -1n;
  if (scenario === SCENARIOS.DISPUTE_EARLY) {
    discrepancyStep = BigInt(Math.floor(programSize * 0.2)); // 20% through
  } else if (scenario === SCENARIOS.DISPUTE_LATE) {
    discrepancyStep = BigInt(Math.floor(programSize * 0.8)); // 80% through
  }

  metrics.startTimer('challengerExecution');
  for (let i = 0; i < instructions.length; i++) {
    challengerState = mipsExecutor.executeStep(challengerState, instructions[i]);

    // Introduce discrepancy if applicable
    if (challengerState.step === discrepancyStep) {
      challengerState = { ...challengerState, registers: [...challengerState.registers] };
      challengerState.registers[5] = 12345n; // Wrong value
      console.log(`  ⚠️  Introducing discrepancy at step ${discrepancyStep}`);
    }

    challengerHistory.set(challengerState.step, { ...challengerState, registers: [...challengerState.registers] });
  }
  const chalExecTime = metrics.stopTimer('challengerExecution');

  console.log(`  Executed ${instructions.length} instructions`);
  console.log(`  Execution time: ${chalExecTime}ms`);
  console.log();

  // ============================================
  // Step 3: State Comparison
  // ============================================
  console.log('Step 3: State Comparison');
  console.log('─'.repeat(50));

  const seqHash = hashMipsStateKeccak(sequencerState);
  const chalHash = hashMipsStateKeccak(challengerState);
  const statesMatch = seqHash === chalHash;

  console.log(`  Sequencer hash:  ${seqHash.slice(0, 20)}...`);
  console.log(`  Challenger hash: ${chalHash.slice(0, 20)}...`);
  console.log(`  Match: ${statesMatch ? '✓ Yes' : '✗ No'}`);
  console.log();

  // ============================================
  // Step 4: Handle Scenario
  // ============================================
  if (scenario === SCENARIOS.HAPPY_PATH || statesMatch) {
    console.log('Step 4: Happy Path - No Dispute');
    console.log('─'.repeat(50));
    console.log('  States match, no dispute needed.');
    console.log('  ✓ Batch finalized successfully');
  } else if (scenario === SCENARIOS.TIMEOUT) {
    console.log('Step 4: Timeout Scenario');
    console.log('─'.repeat(50));
    console.log('  Simulating timeout...');

    const disputeId = `timeout-dispute-${Date.now()}`;
    channelManager.createChannel(
      disputeId,
      sequencerWallet.address,
      challengerWallet.address,
      0n,
      BigInt(instructions.length)
    );

    metrics.recordMessage('channelOpen', 200);

    // Simulate timeout
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log('  ⏱️  Timeout triggered');
    console.log('  Challenger wins by default (sequencer did not respond)');

    channelManager.updateChannel(disputeId, { status: 'closed' });
  } else {
    // Dispute scenarios
    console.log('Step 4: Dispute Detection & Bisection');
    console.log('─'.repeat(50));

    const disputeId = `dispute-${Date.now()}`;
    channelManager.createChannel(
      disputeId,
      sequencerWallet.address,
      challengerWallet.address,
      0n,
      BigInt(instructions.length)
    );

    metrics.recordMessage('channelOpen', 200);
    metrics.recordMessage('channelAck', 50);

    // Perform bisection
    metrics.startTimer('bisection');
    let left = 0n;
    let right = BigInt(instructions.length);
    let rounds = 0;

    console.log(`  Starting bisection: [${left}, ${right}]`);

    while (right - left > 1n) {
      const mid = left + (right - left) / 2n;

      const seqMid = sequencerHistory.get(mid)!;
      const chalMid = challengerHistory.get(mid)!;

      const midMatch = hashMipsStateKeccak(seqMid) === hashMipsStateKeccak(chalMid);

      console.log(`  Round ${rounds + 1}: mid=${mid}, match=${midMatch ? '✓' : '✗'}`);

      metrics.recordMessage('bisectionMove', 300);
      metrics.recordMessage('bisectionMove', 300);

      if (midMatch) {
        left = mid;
      } else {
        right = mid;
      }

      rounds++;
    }

    const bisectionDuration = metrics.stopTimer('bisection');
    metrics.recordBisection(rounds, bisectionDuration);

    console.log(`  Bisection complete: disputed step = ${left}`);
    console.log(`  Rounds: ${rounds}, Duration: ${bisectionDuration}ms`);
    console.log();

    // ============================================
    // Step 5: ZK Proof Generation (Real-time)
    // ============================================
    console.log('Step 5: ZK Proof Generation');
    console.log('─'.repeat(50));

    const preState = sequencerHistory.get(left)!;
    const postState = sequencerHistory.get(left + 1n)!;
    const disputedInstruction = instructions[Number(left)];

    console.log(`  Pre-state (step ${left}):`);
    console.log(`    PC: ${preState.pc}`);
    console.log(`  Post-state (step ${left + 1n}):`);
    console.log(`    PC: ${postState.pc}`);

    metrics.recordMessage('proofRequest', 100);

    const circuitFilesExist = fs.existsSync(CIRCUIT_WASM) && fs.existsSync(CIRCUIT_ZKEY);

    let proof: any = null;
    let proofPublicSignals: string[] = [];

    metrics.startTimer('proofGeneration');

    if (circuitFilesExist) {
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
        instruction: disputedInstruction.toString(),
        memAddress: '0',
        memValue: '0',
        memProof: Array(20).fill('0'),
        postPC: postState.pc.toString(),
        postNextPC: postState.nextPC.toString(),
        postRegisters: postState.registers.map((r: bigint) => r.toString()),
        postHi: postState.hi.toString(),
        postLo: postState.lo.toString(),
        postMemoryRoot: postState.memoryRoot.toString(),
        postStep: postState.step.toString(),
      };

      // Generate proof in real-time
      console.log('  Generating ZK proof via snarkjs.groth16.fullProve()...');
      const result = await snarkjs.groth16.fullProve(circuitInput, CIRCUIT_WASM, CIRCUIT_ZKEY);
      proof = result.proof;
      proofPublicSignals = result.publicSignals;
    } else {
      console.log('  ⚠️  Circuit build files not found. Skipping real proof generation.');
      console.log('     Build circuits first: cd circuits && npm run build');
    }

    const proofGenTime = metrics.stopTimer('proofGeneration');
    metrics.recordProofGeneration(proofGenTime);

    if (proof) {
      console.log(`  ✓ ZK proof generated in ${proofGenTime}ms`);
      console.log(`  Public signals: preHash=${proofPublicSignals[0]?.slice(0, 10)}..., postHash=${proofPublicSignals[1]?.slice(0, 10)}...`);
    }

    metrics.recordMessage('proofSubmit', 500);
    console.log();

    // ============================================
    // Step 6: Off-chain Verification (snarkjs)
    // ============================================
    console.log('Step 6: Off-chain Verification (snarkjs)');
    console.log('─'.repeat(50));

    metrics.startTimer('verification');

    if (proof && fs.existsSync(CIRCUIT_VKEY)) {
      const vkey = JSON.parse(fs.readFileSync(CIRCUIT_VKEY, 'utf-8'));
      const isValid = await snarkjs.groth16.verify(vkey, proofPublicSignals, proof);
      const verifyTime = metrics.stopTimer('verification');
      metrics.recordOnChainVerification(verifyTime);

      console.log(`  Verification result: ${isValid ? 'VALID' : 'INVALID'}`);
      console.log(`  ✓ Proof verified in ${verifyTime}ms`);
    } else {
      const verifyTime = metrics.stopTimer('verification');
      metrics.recordOnChainVerification(verifyTime);

      if (!proof) {
        console.log('  ⚠️  No proof to verify (circuit files missing).');
      } else {
        console.log('  ⚠️  Verification key not found. Skipping verification.');
      }
    }
    console.log();

    // ============================================
    // Step 7: Resolution
    // ============================================
    console.log('Step 7: Dispute Resolution');
    console.log('─'.repeat(50));

    channelManager.updateChannel(disputeId, { status: 'closed' });

    // Determine winner
    const actualStep = left;
    const preStateSeq = sequencerHistory.get(actualStep)!;
    const postStateSeq = sequencerHistory.get(actualStep + 1n)!;
    const preStateChal = challengerHistory.get(actualStep)!;
    const postStateChal = challengerHistory.get(actualStep + 1n)!;

    // If sequencer's transition is correct, sequencer wins
    const seqPreHash = hashMipsStateKeccak(preStateSeq);
    const chalPreHash = hashMipsStateKeccak(preStateChal);

    if (seqPreHash === chalPreHash) {
      // Pre-states match, so discrepancy is in execution
      console.log('  📊 Result: Sequencer transition was VALID');
      console.log('  🏆 Winner: Sequencer');
    } else {
      console.log('  📊 Result: Challenger transition was VALID');
      console.log('  🏆 Winner: Challenger');
    }
  }

  const totalTime = metrics.stopTimer('totalScenario');
  metrics.recordTotalDisputeResolution(totalTime);

  // ============================================
  // Summary
  // ============================================
  console.log();
  console.log('═'.repeat(70));
  console.log('SCENARIO SUMMARY');
  console.log('═'.repeat(70));
  console.log(`  Scenario: ${scenario}`);
  console.log(`  Program Size: ${programSize} instructions`);
  console.log(`  Total Duration: ${totalTime}ms`);
  console.log(`  Messages Exchanged: ${metrics.getMessageMetrics().total.count}`);
  console.log(`  Data Transferred: ${metrics.getMessageMetrics().total.totalBytes} bytes`);
  console.log('═'.repeat(70));
}

// ============================================
// Main
// ============================================
async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              SI-RVP - Demo Scenario Runner                           ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const args = process.argv.slice(2);
  const scenario = (args[0] as ScenarioType) || SCENARIOS.DISPUTE_EARLY;
  const programSize = parseInt(args[1]) || 20;

  const validScenarios = Object.values(SCENARIOS);
  if (!validScenarios.includes(scenario)) {
    console.log(`\nUsage: ts-node demo-scenario.ts <scenario> [program_size]`);
    console.log(`\nScenarios:`);
    validScenarios.forEach(s => console.log(`  - ${s}`));
    console.log(`\nExample: ts-node demo-scenario.ts dispute_early 50`);
    process.exit(1);
  }

  await runScenario(scenario, programSize);

  // Run comparison if requested
  if (args.includes('--compare')) {
    console.log('\n\n');
    console.log('╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║              Running All Scenarios for Comparison                    ║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝');

    for (const s of validScenarios) {
      if (s !== SCENARIOS.TIMEOUT) {
        await runScenario(s, programSize);
      }
    }
  }
}

main().catch(console.error);
