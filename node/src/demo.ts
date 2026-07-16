/**
 * SI-RVP - Demo Script
 *
 * Full flow demonstration with real on-chain transactions:
 * 1. Sequencer executes MIPS program
 * 2. Challenger detects discrepancy
 * 3. Off-chain bisection protocol
 * 4. State root proposal on-chain
 * 5. Dispute initiation + bond deposit
 * 6. Bisection result submission on-chain
 * 7. ZK proof generation + on-chain verification
 * 8. Dispute resolution confirmation
 *
 * Prerequisites:
 *   cd contracts && npx hardhat node          # terminal 1
 *   cd contracts && npx hardhat run scripts/deploy.ts --network localhost  # terminal 2
 *   cd node && npm run demo                   # terminal 3
 */

import * as fs from 'fs';
import * as path from 'path';
import { ethers, Wallet } from 'ethers';
// @ts-ignore - snarkjs has no type declarations
import * as snarkjs from 'snarkjs';
import { MipsExecutor, MipsInstructionBuilder } from './common/mips';
import { MipsState } from './common/types';
import { PoseidonHasher } from './common/prover';
import { hashMipsStateKeccak, hashBisectionCommitment } from './common/hash';

// ============================================
// Contract ABIs (minimal)
// ============================================

const ROLLUP_MANAGER_ABI = [
  'function proposeStateRoot(bytes32 stateRoot, uint256 batchIndex) external',
  'function latestBatchIndex() external view returns (uint256)',
];

const DISPUTE_MANAGER_ABI = [
  'function initiateDispute(uint256 batchIndex, bytes32 claimedStateRoot) external payable returns (uint256 disputeId)',
  'function depositSequencerBond(uint256 disputeId) external payable',
  'function submitBisectionResult(uint256 disputeId, bytes32 bisectionCommitment, uint256 disputedStep, bytes calldata challengerSig, bytes calldata sequencerSig) external',
  'function submitProof(uint256 disputeId, uint256[8] calldata proof, uint256[] calldata publicInputs) external',
  'function getDispute(uint256 disputeId) external view returns (tuple(uint256 batchIndex, address challenger, address sequencer, bytes32 challengerClaim, bytes32 sequencerClaim, uint256 challengerBond, uint256 sequencerBond, uint256 createdAt, uint256 deadline, bytes32 bisectionCommitment, uint8 status))',
  'function BOND_AMOUNT() external view returns (uint256)',
  'event DisputeInitiated(uint256 indexed disputeId, uint256 indexed batchIndex, address indexed challenger, bytes32 challengerClaim)',
];

const ZK_VERIFIER_ABI = [
  'function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[] calldata publicInputs) external view returns (bool)',
];

// ============================================
// Demo Configuration
// ============================================

const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';

// Hardhat default accounts — only safe on localhost
const SEQUENCER_PRIVATE_KEY = process.env.SEQUENCER_PRIVATE_KEY
  || (RPC_URL.includes('127.0.0.1') || RPC_URL.includes('localhost')
    ? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' : undefined); // Account #0
const CHALLENGER_PRIVATE_KEY = process.env.CHALLENGER_PRIVATE_KEY
  || (RPC_URL.includes('127.0.0.1') || RPC_URL.includes('localhost')
    ? '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' : undefined); // Account #1

if (!SEQUENCER_PRIVATE_KEY || !CHALLENGER_PRIVATE_KEY) {
  throw new Error('SEQUENCER_PRIVATE_KEY and CHALLENGER_PRIVATE_KEY must be set for non-localhost RPC');
}
const SEQ_KEY: string = SEQUENCER_PRIVATE_KEY;
const CHAL_KEY: string = CHALLENGER_PRIVATE_KEY;

const DEPLOYMENT_PATH = path.join(__dirname, '../../contracts/deployments/localhost-latest.json');
const CIRCUIT_WASM = path.join(__dirname, '../../circuits/build/mips_single_step_js/mips_single_step.wasm');
const CIRCUIT_ZKEY = path.join(__dirname, '../../circuits/build/mips_single_step_final.zkey');

// ============================================
// Demo Execution
// ============================================

async function runDemo(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         SI-RVP - End-to-End Demo                             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();

  // ============================================
  // Pre-flight: Connect to Hardhat + load contracts
  // ============================================
  let provider: ethers.JsonRpcProvider;
  try {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    await provider.getBlockNumber();
  } catch {
    console.error('❌ Hardhat 노드가 실행 중이지 않습니다. 먼저 실행하세요:');
    console.error('   cd contracts && npx hardhat node');
    process.exit(1);
  }

  if (!fs.existsSync(DEPLOYMENT_PATH)) {
    console.error('❌ 컨트랙트가 배포되지 않았습니다. 먼저 배포하세요:');
    console.error('   cd contracts && npx hardhat run scripts/deploy.ts --network localhost');
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, 'utf-8'));

  const sequencerWallet = new Wallet(SEQ_KEY, provider);
  const challengerWallet = new Wallet(CHAL_KEY, provider);

  const rollupManager = new ethers.Contract(
    deployment.contracts.RollupManager,
    ROLLUP_MANAGER_ABI,
    sequencerWallet
  );
  const disputeManagerSeq = new ethers.Contract(
    deployment.contracts.DisputeManager,
    DISPUTE_MANAGER_ABI,
    sequencerWallet
  );
  const disputeManagerChal = new ethers.Contract(
    deployment.contracts.DisputeManager,
    DISPUTE_MANAGER_ABI,
    challengerWallet
  );
  const zkVerifier = new ethers.Contract(
    deployment.contracts.ZKVerifier,
    ZK_VERIFIER_ABI,
    provider
  );

  console.log('📋 Demo Participants:');
  console.log(`   Sequencer:  ${sequencerWallet.address}`);
  console.log(`   Challenger: ${challengerWallet.address}`);
  console.log();
  console.log('📋 Contracts:');
  console.log(`   RollupManager:  ${deployment.contracts.RollupManager}`);
  console.log(`   DisputeManager: ${deployment.contracts.DisputeManager}`);
  console.log(`   ZKVerifier:     ${deployment.contracts.ZKVerifier}`);
  console.log();

  // Initialize MIPS executor
  const mipsExecutor = new MipsExecutor();

  // ============================================
  // Step 1: Execute MIPS Program
  // ============================================
  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│ Step 1: Execute MIPS Program                                │');
  console.log('└──────────────────────────────────────────────────────────────┘');

  const instructions: bigint[] = [
    MipsInstructionBuilder.addi(1, 0, 100),  // r1 = 100
    MipsInstructionBuilder.addi(2, 0, 50),   // r2 = 50
    MipsInstructionBuilder.add(3, 1, 2),     // r3 = r1 + r2 = 150
    MipsInstructionBuilder.sub(4, 1, 2),     // r4 = r1 - r2 = 50
    MipsInstructionBuilder.and(5, 1, 2),     // r5 = r1 & r2
    MipsInstructionBuilder.or(6, 1, 2),      // r6 = r1 | r2
    MipsInstructionBuilder.slt(7, 2, 1),     // r7 = (r2 < r1) = 1
    MipsInstructionBuilder.addi(8, 3, 10),   // r8 = r3 + 10 = 160
    MipsInstructionBuilder.addi(9, 4, 20),   // r9 = r4 + 20 = 70
    MipsInstructionBuilder.add(10, 8, 9),    // r10 = r8 + r9 = 230
  ];

  console.log(`   Program: ${instructions.length} MIPS instructions`);

  // Sequencer executes program
  let sequencerState = MipsExecutor.createInitialState();
  const sequencerStateHistory: Map<bigint, MipsState> = new Map();
  sequencerStateHistory.set(0n, { ...sequencerState, registers: [...sequencerState.registers] });

  for (let i = 0; i < instructions.length; i++) {
    sequencerState = mipsExecutor.executeStep(sequencerState, instructions[i]);
    sequencerStateHistory.set(sequencerState.step, { ...sequencerState, registers: [...sequencerState.registers] });
  }

  console.log(`   Sequencer final state:`);
  console.log(`     PC: ${sequencerState.pc}`);
  console.log(`     Step: ${sequencerState.step}`);
  console.log(`     r3 (100+50): ${sequencerState.registers[3]}`);
  console.log(`     r10 (final): ${sequencerState.registers[10]}`);

  const sequencerStateHash = hashMipsStateKeccak(sequencerState);
  console.log(`   Sequencer state hash: ${sequencerStateHash.slice(0, 20)}...`);
  console.log();

  // ============================================
  // Step 2: Challenger Detects Discrepancy
  // ============================================
  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│ Step 2: Challenger Detects Discrepancy                      │');
  console.log('└──────────────────────────────────────────────────────────────┘');

  let challengerState = MipsExecutor.createInitialState();
  const challengerStateHistory: Map<bigint, MipsState> = new Map();
  challengerStateHistory.set(0n, { ...challengerState, registers: [...challengerState.registers] });

  const discrepancyStep = 5n;

  for (let i = 0; i < instructions.length; i++) {
    challengerState = mipsExecutor.executeStep(challengerState, instructions[i]);

    if (challengerState.step === discrepancyStep) {
      challengerState = {
        ...challengerState,
        registers: [...challengerState.registers],
      };
      challengerState.registers[5] = 999n; // Wrong value
    }

    challengerStateHistory.set(challengerState.step, { ...challengerState, registers: [...challengerState.registers] });
  }

  const challengerStateHash = hashMipsStateKeccak(challengerState);
  console.log(`   Challenger state hash: ${challengerStateHash.slice(0, 20)}...`);
  console.log(`   Discrepancy detected! State hashes don't match.`);
  console.log(`   Discrepancy introduced at step ${discrepancyStep}`);
  console.log();

  // ============================================
  // Step 3: Off-chain Bisection Protocol
  // ============================================
  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│ Step 3: Off-chain Bisection Protocol                        │');
  console.log('└──────────────────────────────────────────────────────────────┘');

  const startStep = 0n;
  const endStep = BigInt(instructions.length);

  console.log(`   Dispute range: step ${startStep} to ${endStep}`);
  console.log(`   Starting bisection...`);
  console.log();

  let bisectionLeft = startStep;
  let bisectionRight = endStep;
  let depth = 0;

  while (bisectionRight - bisectionLeft > 1n) {
    const mid = bisectionLeft + (bisectionRight - bisectionLeft) / 2n;

    const sequencerMidState = sequencerStateHistory.get(mid)!;
    const challengerMidState = challengerStateHistory.get(mid)!;

    const seqHash = hashMipsStateKeccak(sequencerMidState);
    const chalHash = hashMipsStateKeccak(challengerMidState);

    const match = seqHash === chalHash;

    console.log(`   Depth ${depth}: midpoint=${mid}, match=${match ? '✓' : '✗'}`);

    if (match) {
      bisectionLeft = mid;
    } else {
      bisectionRight = mid;
    }

    depth++;
  }

  const disputedStep = bisectionLeft;
  console.log();
  console.log(`   Disputed step identified: ${disputedStep}`);
  console.log(`   Bisection completed in ${depth} rounds`);
  console.log();

  // ============================================
  // Step 4: Propose State Root On-chain
  // ============================================
  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│ Step 4: Propose State Root On-chain                         │');
  console.log('└──────────────────────────────────────────────────────────────┘');

  const latestBatch = await rollupManager.latestBatchIndex();
  const newBatchIndex = BigInt(latestBatch) + 1n;

  const tx1 = await rollupManager.proposeStateRoot(sequencerStateHash, newBatchIndex);
  const receipt1 = await tx1.wait();
  if (!receipt1) throw new Error('proposeStateRoot transaction was not mined');

  console.log(`   State root proposed for batch ${newBatchIndex}`);
  console.log(`   Tx: ${receipt1.hash}`);
  console.log(`   Gas used: ${receipt1.gasUsed.toString()}`);
  console.log();

  // ============================================
  // Step 5: Initiate Dispute + Deposit Bonds
  // ============================================
  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│ Step 5: Initiate Dispute + Deposit Bonds                    │');
  console.log('└──────────────────────────────────────────────────────────────┘');

  const bondAmount = await disputeManagerChal.BOND_AMOUNT();
  console.log(`   Required bond: ${ethers.formatEther(bondAmount)} ETH`);

  // Challenger initiates dispute
  const tx2 = await disputeManagerChal.initiateDispute(newBatchIndex, challengerStateHash, {
    value: bondAmount,
  });
  const receipt2 = await tx2.wait();
  if (!receipt2) throw new Error('initiateDispute transaction was not mined');

  const disputeEvent = receipt2.logs.find(
    (log: any) => log.fragment?.name === 'DisputeInitiated'
  );
  if (!disputeEvent) {
    throw new Error('DisputeInitiated event not found in transaction receipt');
  }
  const disputeId = disputeEvent.args[0];

  console.log(`   Dispute initiated with ID: ${disputeId}`);
  console.log(`   Tx: ${receipt2.hash}`);
  console.log(`   Gas used: ${receipt2.gasUsed.toString()}`);

  // Sequencer deposits bond
  await new Promise(resolve => setTimeout(resolve, 1000));
  await provider.getBlockNumber();

  const tx3 = await disputeManagerSeq.depositSequencerBond(disputeId, {
    value: bondAmount,
  });
  const receipt3 = await tx3.wait();
  if (!receipt3) throw new Error('depositSequencerBond transaction was not mined');

  console.log(`   Sequencer bond deposited`);
  console.log(`   Tx: ${receipt3.hash}`);
  console.log(`   Gas used: ${receipt3.gasUsed.toString()}`);
  console.log();

  // ============================================
  // Step 6: Submit Bisection Result On-chain
  // ============================================
  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│ Step 6: Submit Bisection Result On-chain                    │');
  console.log('└──────────────────────────────────────────────────────────────┘');

  const preState = sequencerStateHistory.get(disputedStep)!;
  const postState = sequencerStateHistory.get(disputedStep + 1n)!;

  // Poseidon hasher binds the bisection commitment to the ZK circuit's
  // public outputs (DisputeManager.sol:252-254 expects Poseidon-hashed
  // states, not keccak-of-state, with (pre, post, step) order).
  const poseidon = new PoseidonHasher();
  await poseidon.initialize();

  const preStateHash = poseidon.hashMipsState(preState);
  const postStateHash = poseidon.hashMipsState(postState);
  const preStateHashHex = '0x' + preStateHash.toString(16).padStart(64, '0');
  const postStateHashHex = '0x' + postStateHash.toString(16).padStart(64, '0');

  const bisectionCommitment = hashBisectionCommitment(
    preStateHashHex,
    postStateHashHex,
    disputedStep
  );

  const messageHash = ethers.keccak256(
    ethers.solidityPacked(
      ['uint256', 'bytes32', 'uint256'],
      [disputeId, bisectionCommitment, disputedStep]
    )
  );
  const challengerSig = await challengerWallet.signMessage(ethers.getBytes(messageHash));
  const sequencerSig = await sequencerWallet.signMessage(ethers.getBytes(messageHash));

  await new Promise(resolve => setTimeout(resolve, 1000));
  await provider.getBlockNumber();

  const tx4 = await disputeManagerSeq.submitBisectionResult(
    disputeId,
    bisectionCommitment,
    disputedStep,
    challengerSig,
    sequencerSig
  );
  const receipt4 = await tx4.wait();
  if (!receipt4) throw new Error('submitBisectionResult transaction was not mined');

  console.log(`   Bisection commitment: ${bisectionCommitment.slice(0, 20)}...`);
  console.log(`   Disputed step: ${disputedStep}`);
  console.log(`   Tx: ${receipt4.hash}`);
  console.log(`   Gas used: ${receipt4.gasUsed.toString()}`);
  console.log();

  // ============================================
  // Step 7: ZK Proof Generation + On-chain Verification
  // ============================================
  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│ Step 7: ZK Proof Generation + On-chain Verification         │');
  console.log('└──────────────────────────────────────────────────────────────┘');

  console.log(`   Pre-state (step ${disputedStep}):`);
  console.log(`     PC: ${preState.pc}, r5: ${preState.registers[5]}`);
  console.log(`   Post-state (step ${disputedStep + 1n}):`);
  console.log(`     PC: ${postState.pc}, r5: ${postState.registers[5]}`);

  if (!fs.existsSync(CIRCUIT_WASM) || !fs.existsSync(CIRCUIT_ZKEY)) {
    console.error('❌ Circuit build 파일이 없습니다.');
    console.error('   먼저 circuit을 빌드하세요: cd circuits && npm run build');
    process.exit(1);
  }

  // Poseidon hasher and pre/post state hashes are computed in Step 6 above
  // (single instance, reused for both bisection commitment and circuit input).

  const instruction = instructions[Number(disputedStep)];

  // Build circuit input
  const circuitInput = {
    preStateHash: preStateHash.toString(),
    postStateHash: postStateHash.toString(),
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
    postStep: postState.step.toString(),
  };

  // Generate proof with snarkjs
  console.log(`   Generating ZK proof (snarkjs groth16.fullProve)...`);
  const proofStart = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput, CIRCUIT_WASM, CIRCUIT_ZKEY
  );
  const proofTime = Date.now() - proofStart;
  console.log(`   Proof generated in ${proofTime}ms`);
  console.log(`   Public signals: valid=${publicSignals[0]}, preHash=${publicSignals[1].slice(0, 10)}..., postHash=${publicSignals[2].slice(0, 10)}...`);

  // Format for on-chain verification
  const a: [bigint, bigint] = [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])];
  const b: [[bigint, bigint], [bigint, bigint]] = [
    [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
    [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
  ];
  const c: [bigint, bigint] = [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])];
  const pubInputs = publicSignals.map((s: string) => BigInt(s));

  const isValid = await zkVerifier.verifyProof(a, b, c, pubInputs);
  console.log(`   On-chain ZK verification: ${isValid ? 'VALID' : 'INVALID'}`);

  // Submit proof to DisputeManager
  const proofForContract: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [
    BigInt(proof.pi_a[0]),
    BigInt(proof.pi_a[1]),
    BigInt(proof.pi_b[0][1]),
    BigInt(proof.pi_b[0][0]),
    BigInt(proof.pi_b[1][1]),
    BigInt(proof.pi_b[1][0]),
    BigInt(proof.pi_c[0]),
    BigInt(proof.pi_c[1]),
  ];

  await new Promise(resolve => setTimeout(resolve, 1000));
  await provider.getBlockNumber();

  const tx5 = await disputeManagerSeq.submitProof(disputeId, proofForContract, pubInputs);
  const receipt5 = await tx5.wait();
  if (!receipt5) throw new Error('submitProof transaction was not mined');

  console.log(`   Proof submitted on-chain`);
  console.log(`   Tx: ${receipt5.hash}`);
  console.log(`   Gas used: ${receipt5.gasUsed.toString()}`);
  console.log();

  // ============================================
  // Step 8: Dispute Resolution Confirmation
  // ============================================
  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│ Step 8: Dispute Resolution Confirmation                     │');
  console.log('└──────────────────────────────────────────────────────────────┘');

  const disputeInfo = await disputeManagerSeq.getDispute(disputeId);
  const statusNames = ['None', 'Initiated', 'ProofSubmitted', 'Resolved', 'Timeout'];
  const statusName = statusNames[disputeInfo.status] ?? `Unknown(${disputeInfo.status})`;

  console.log(`   Dispute ID: ${disputeId}`);
  console.log(`   Status: ${statusName}`);
  console.log(`   Challenger: ${disputeInfo.challenger}`);
  console.log(`   Sequencer: ${disputeInfo.sequencer}`);
  console.log(`   Challenger Bond: ${ethers.formatEther(disputeInfo.challengerBond)} ETH`);
  console.log(`   Sequencer Bond: ${ethers.formatEther(disputeInfo.sequencerBond)} ETH`);
  console.log();

  // ============================================
  // Summary
  // ============================================

  const totalGas =
    BigInt(receipt1.gasUsed) +
    BigInt(receipt2.gasUsed) +
    BigInt(receipt3.gasUsed) +
    BigInt(receipt4.gasUsed) +
    BigInt(receipt5.gasUsed);

  const txSummary = [
    { name: 'proposeStateRoot', gas: receipt1.gasUsed.toString() },
    { name: 'initiateDispute', gas: receipt2.gasUsed.toString() },
    { name: 'depositSequencerBond', gas: receipt3.gasUsed.toString() },
    { name: 'submitBisectionResult', gas: receipt4.gasUsed.toString() },
    { name: 'submitProof', gas: receipt5.gasUsed.toString() },
  ];

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                     Demo Summary                           ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║ MIPS program executed (${instructions.length} instructions)                    ║`);
  console.log(`║ Discrepancy detected at step ${discrepancyStep}                             ║`);
  console.log(`║ Bisection narrowed to single step in ${depth} rounds              ║`);
  console.log(`║ 5 on-chain transactions executed                            ║`);
  console.log(`║ ZK proof verified on-chain: ${isValid ? 'VALID' : 'INVALID'}                          ║`);
  console.log(`║ Dispute status: ${statusName.padEnd(42)}║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║ Gas Usage:                                                  ║');
  for (const tx of txSummary) {
    console.log(`║   ${tx.name.padEnd(24)} ${tx.gas.padStart(10)}                    ║`);
  }
  console.log(`║   ${'─'.repeat(37)}                   ║`);
  console.log(`║   ${'Total'.padEnd(24)} ${totalGas.toString().padStart(10)}                    ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();
  console.log('Demo completed successfully!');
}

// ============================================
// Main
// ============================================
runDemo().catch((error) => {
  console.error('Demo failed:', error);
  process.exit(1);
});
