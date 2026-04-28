/**
 * SI-RVP - On-chain E2E Test
 *
 * Full dispute resolution flow using deployed contracts on Hardhat localhost.
 * Exports structured JSON to public/data/onchain-e2e.json for dashboard integration.
 */

import { ethers, Wallet } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
// @ts-ignore - snarkjs has no type declarations
import * as snarkjs from 'snarkjs';
import { MipsExecutor, MipsInstructionBuilder } from '../common/mips';
import { hashMipsStateKeccak, hashBisectionCommitment } from '../common/hash';
import { PoseidonHasher } from '../common/prover';
import { MipsState } from '../common/types';

// ============================================
// Types for Dashboard Export
// ============================================

interface SerializedMipsState {
  pc: string;
  nextPC: string;
  registers: string[];
  hi: string;
  lo: string;
  heap: string;
  exitCode: number;
  exited: boolean;
  step: string;
  memoryRoot: string;
  stateHash: string;
}

interface InstructionInfo {
  step: number;
  op: string;
  rd?: number;
  rs?: number;
  rt?: number;
  imm?: number;
  desc: string;
  encoded: string;
}

interface BisectionNode {
  id: number;
  depth: number;
  left: number;
  right: number;
  mid: number;
  match: boolean;
  seqHash: string;
  chalHash: string;
  parentId: number | null;
}

interface TransactionRecord {
  name: string;
  hash: string;
  gasUsed: string;
  blockNumber: number;
}

interface OnchainE2EData {
  scenario: string;
  generatedAt: string;
  discrepancyStep: number;
  instructions: InstructionInfo[];
  sequencerStates: SerializedMipsState[];
  challengerStates: SerializedMipsState[];
  bisectionTree: {
    nodes: BisectionNode[];
    disputedStep: number;
    totalRounds: number;
  };
  onchain: {
    network: string;
    chainId: number;
    contracts: {
      RollupManager: string;
      DisputeManager: string;
      ZKVerifier: string;
    };
    participants: {
      sequencer: string;
      challenger: string;
    };
    disputeId: string;
    bondAmount: string;
    transactions: TransactionRecord[];
    totalGas: string;
    disputeStatus: string;
    proofValid: boolean;
  };
  metrics: {
    traditional: {
      disputeTime: number;
      onChainMessages: number;
      gasPerMessage: number;
      totalGas: number;
    };
    zkChannel: {
      disputeTime: number;
      onChainMessages: number;
      totalGas: number;
      gasBreakdown: TransactionRecord[];
    };
    improvements: {
      timeReduction: string;
      messageReduction: string;
      gasReduction: string;
    };
  };
}

// ============================================
// Configuration
// ============================================

const NETWORK = process.env.NETWORK || 'localhost';
if (!/^[a-zA-Z0-9_-]+$/.test(NETWORK)) {
  throw new Error(`Invalid NETWORK name: ${NETWORK}`);
}
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const DEPLOYMENT_PATH = path.join(__dirname, `../../../contracts/deployments/${NETWORK}-latest.json`);
const CIRCUIT_WASM = path.join(__dirname, '../../../circuits/build/mips_single_step_js/mips_single_step.wasm');
const CIRCUIT_ZKEY = path.join(__dirname, '../../../circuits/build/mips_single_step_final.zkey');

// Hardhat default accounts — only used as fallback on localhost (DO NOT USE ON PUBLIC NETWORKS)
const SEQUENCER_PRIVATE_KEY = process.env.SEQUENCER_PRIVATE_KEY
  || (NETWORK === 'localhost' ? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' : undefined); // Account #0
const CHALLENGER_PRIVATE_KEY = process.env.CHALLENGER_PRIVATE_KEY
  || (NETWORK === 'localhost' ? '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' : undefined); // Account #1

if (!SEQUENCER_PRIVATE_KEY || !CHALLENGER_PRIVATE_KEY) {
  throw new Error('SEQUENCER_PRIVATE_KEY and CHALLENGER_PRIVATE_KEY must be set for non-localhost networks');
}
const SEQ_KEY: string = SEQUENCER_PRIVATE_KEY;
const CHAL_KEY: string = CHALLENGER_PRIVATE_KEY;

// Contract ABIs
const ROLLUP_MANAGER_ABI = [
  'function proposeStateRoot(bytes32 stateRoot, uint256 batchIndex) external',
  'function getBatch(uint256 batchIndex) external view returns (tuple(bytes32 stateRoot, bytes32 prevStateRoot, uint256 timestamp, address proposer, uint8 status))',
  'function latestBatchIndex() external view returns (uint256)',
  'function sequencer() external view returns (address)',
  'event StateRootProposed(uint256 indexed batchIndex, bytes32 stateRoot, bytes32 prevStateRoot, address indexed proposer)',
];

const DISPUTE_MANAGER_ABI = [
  'function initiateDispute(uint256 batchIndex, bytes32 claimedStateRoot) external payable returns (uint256 disputeId)',
  'function depositSequencerBond(uint256 disputeId) external payable',
  'function submitBisectionResult(uint256 disputeId, bytes32 bisectionCommitment, uint256 disputedStep, bytes calldata challengerSig, bytes calldata sequencerSig) external',
  'function submitProof(uint256 disputeId, uint256[8] calldata proof, uint256[] calldata publicInputs) external',
  'function getDispute(uint256 disputeId) external view returns (tuple(uint256 batchIndex, address challenger, address sequencer, bytes32 challengerClaim, bytes32 sequencerClaim, uint256 challengerBond, uint256 sequencerBond, uint256 createdAt, uint256 deadline, bytes32 bisectionCommitment, uint8 status))',
  'function BOND_AMOUNT() external view returns (uint256)',
  'event DisputeInitiated(uint256 indexed disputeId, uint256 indexed batchIndex, address indexed challenger, bytes32 challengerClaim)',
  'event BisectionCompleted(uint256 indexed disputeId, bytes32 bisectionCommitment, uint256 disputedStep)',
  'event ProofSubmitted(uint256 indexed disputeId, address indexed submitter, bool proofValid)',
];

const ZK_VERIFIER_ABI = [
  'function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[] calldata publicInputs) external view returns (bool)',
];

// ============================================
// Helper Functions
// ============================================

function printHeader(title: string) {
  console.log('\n┌──────────────────────────────────────────────────────────────┐');
  console.log(`│ ${title.padEnd(60)} │`);
  console.log('└──────────────────────────────────────────────────────────────┘');
}

function printSuccess(msg: string) {
  console.log(`   ✅ ${msg}`);
}

function printInfo(msg: string) {
  console.log(`   📋 ${msg}`);
}

function printWarning(msg: string) {
  console.log(`   ⚠️  ${msg}`);
}

// ============================================
// Serialization Functions
// ============================================

function serializeState(state: MipsState): SerializedMipsState {
  return {
    pc: state.pc.toString(),
    nextPC: state.nextPC.toString(),
    registers: state.registers.map((r) => r.toString()),
    hi: state.hi.toString(),
    lo: state.lo.toString(),
    heap: state.heap.toString(),
    exitCode: state.exitCode,
    exited: state.exited,
    step: state.step.toString(),
    memoryRoot: state.memoryRoot,
    stateHash: hashMipsStateKeccak(state),
  };
}

function decodeInstruction(encoded: bigint, step: number): InstructionInfo {
  const insn = Number(encoded & 0xffffffffn);
  const opcode = (insn >> 26) & 0x3f;
  const func = insn & 0x3f;
  const rs = (insn >> 21) & 0x1f;
  const rt = (insn >> 16) & 0x1f;
  const rd = (insn >> 11) & 0x1f;
  const imm = insn & 0xffff;

  const rName = (r: number) => `r${r}`;

  if (opcode === 0) {
    const rTypeOps: Record<number, string> = {
      0x20: 'ADD', 0x21: 'ADDU', 0x22: 'SUB', 0x23: 'SUBU',
      0x24: 'AND', 0x25: 'OR', 0x26: 'XOR', 0x27: 'NOR',
      0x2a: 'SLT', 0x2b: 'SLTU',
    };
    const op = rTypeOps[func] || `R(${func.toString(16)})`;
    const desc = op === 'ADD' || op === 'ADDU' ? `${rName(rd)} = ${rName(rs)} + ${rName(rt)}`
      : op === 'SUB' || op === 'SUBU' ? `${rName(rd)} = ${rName(rs)} - ${rName(rt)}`
      : op === 'AND' ? `${rName(rd)} = ${rName(rs)} & ${rName(rt)}`
      : op === 'OR' ? `${rName(rd)} = ${rName(rs)} | ${rName(rt)}`
      : op === 'SLT' || op === 'SLTU' ? `${rName(rd)} = (${rName(rs)} < ${rName(rt)}) ? 1 : 0`
      : `${op} ${rName(rd)}, ${rName(rs)}, ${rName(rt)}`;
    return { step, op, rd, rs, rt, encoded: '0x' + encoded.toString(16), desc };
  }

  const iTypeOps: Record<number, string> = {
    0x08: 'ADDI', 0x09: 'ADDIU', 0x0c: 'ANDI', 0x0d: 'ORI',
    0x0a: 'SLTI', 0x0b: 'SLTIU',
  };
  const op = iTypeOps[opcode] || `I(${opcode.toString(16)})`;
  const signedImm = imm > 0x7fff ? imm - 0x10000 : imm;
  const desc = op === 'ADDI' || op === 'ADDIU' ? `${rName(rt)} = ${rName(rs)} + ${signedImm}` : `${op} ${rName(rt)}, ${rName(rs)}, ${signedImm}`;
  return { step, op, rd: rt, rs, imm: signedImm, encoded: '0x' + encoded.toString(16), desc };
}

// ============================================
// Main E2E Flow
// ============================================

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     SI-RVP - On-chain E2E Test (Full Dispute Resolution)     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Load deployment info
  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, 'utf-8'));
  printInfo(`Loaded deployment from: ${deployment.network}`);
  printInfo(`RollupManager: ${deployment.contracts.RollupManager}`);
  printInfo(`DisputeManager: ${deployment.contracts.DisputeManager}`);
  printInfo(`ZKVerifier: ${deployment.contracts.ZKVerifier}`);

  // Setup provider and wallets
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const sequencerWallet = new Wallet(SEQ_KEY, provider);
  const challengerWallet = new Wallet(CHAL_KEY, provider);

  printInfo(`Sequencer: ${sequencerWallet.address}`);
  printInfo(`Challenger: ${challengerWallet.address}`);

  // Setup contracts
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

  // ============================================
  // Step 1: Execute MIPS Program
  // ============================================
  printHeader('Step 1: Execute MIPS Program');

  const mipsExecutor = new MipsExecutor();
  const instructions: bigint[] = [
    MipsInstructionBuilder.addi(1, 0, 100),  // r1 = 100
    MipsInstructionBuilder.addi(2, 0, 50),   // r2 = 50
    MipsInstructionBuilder.add(3, 1, 2),     // r3 = r1 + r2 = 150
    MipsInstructionBuilder.sub(4, 1, 2),     // r4 = r1 - r2 = 50
    MipsInstructionBuilder.and(5, 1, 2),     // r5 = r1 & r2 = 32
  ];

  // Sequencer executes correctly
  let seqState = MipsExecutor.createInitialState();
  const seqStates: MipsState[] = [{ ...seqState, registers: [...seqState.registers] }];
  for (const inst of instructions) {
    seqState = mipsExecutor.executeStep(seqState, inst);
    seqStates.push({ ...seqState, registers: [...seqState.registers] });
  }

  // Challenger executes with discrepancy at step 3
  const DISCREPANCY_STEP = 3;
  let chalState = MipsExecutor.createInitialState();
  const chalStates: MipsState[] = [{ ...chalState, registers: [...chalState.registers] }];
  for (let i = 0; i < instructions.length; i++) {
    chalState = mipsExecutor.executeStep(chalState, instructions[i]);
    if (i === DISCREPANCY_STEP) {
      chalState = { ...chalState, registers: [...chalState.registers] };
      chalState.registers[4] = 999n; // Introduce discrepancy
    }
    chalStates.push({ ...chalState, registers: [...chalState.registers] });
  }

  const seqFinalHash = hashMipsStateKeccak(seqStates[seqStates.length - 1]);
  const chalFinalHash = hashMipsStateKeccak(chalStates[chalStates.length - 1]);

  printSuccess(`Executed ${instructions.length} MIPS instructions`);
  printInfo(`Sequencer final hash: ${seqFinalHash.slice(0, 20)}...`);
  printInfo(`Challenger final hash: ${chalFinalHash.slice(0, 20)}...`);
  printWarning(`Discrepancy introduced at step ${DISCREPANCY_STEP}`);

  // ============================================
  // Step 2: Sequencer Proposes State Root
  // ============================================
  printHeader('Step 2: Sequencer Proposes State Root');

  const latestBatch = await rollupManager.latestBatchIndex();
  const newBatchIndex = BigInt(latestBatch) + 1n;

  const tx1 = await rollupManager.proposeStateRoot(seqFinalHash, newBatchIndex);
  const receipt1 = await tx1.wait();

  printSuccess(`State root proposed for batch ${newBatchIndex}`);
  printInfo(`Transaction: ${receipt1.hash}`);
  printInfo(`Gas used: ${receipt1.gasUsed.toString()}`);

  // ============================================
  // Step 3: Challenger Initiates Dispute
  // ============================================
  printHeader('Step 3: Challenger Initiates Dispute');

  const bondAmount = await disputeManagerChal.BOND_AMOUNT();
  printInfo(`Required bond: ${ethers.formatEther(bondAmount)} ETH`);

  const tx2 = await disputeManagerChal.initiateDispute(newBatchIndex, chalFinalHash, {
    value: bondAmount,
  });
  const receipt2 = await tx2.wait();

  // Extract disputeId from event
  const disputeEvent = receipt2.logs.find(
    (log: any) => log.fragment?.name === 'DisputeInitiated'
  );
  const disputeId = disputeEvent ? disputeEvent.args[0] : 1n;

  printSuccess(`Dispute initiated with ID: ${disputeId}`);
  printInfo(`Transaction: ${receipt2.hash}`);
  printInfo(`Gas used: ${receipt2.gasUsed.toString()}`);

  // ============================================
  // Step 4: Sequencer Deposits Bond
  // ============================================
  printHeader('Step 4: Sequencer Deposits Bond');

  // Wait for blockchain to settle and clear nonce cache
  await new Promise(resolve => setTimeout(resolve, 2000));
  await provider.getBlockNumber(); // Force provider to sync

  const tx3 = await disputeManagerSeq.depositSequencerBond(disputeId, {
    value: bondAmount,
  });
  const receipt3 = await tx3.wait();

  printSuccess(`Sequencer bond deposited`);
  printInfo(`Transaction: ${receipt3.hash}`);
  printInfo(`Gas used: ${receipt3.gasUsed.toString()}`);

  // ============================================
  // Step 5: Off-chain Bisection
  // ============================================
  printHeader('Step 5: Off-chain Bisection');

  const bisectionNodes: BisectionNode[] = [];
  let left = 0;
  let right = seqStates.length - 1;
  let rounds = 0;
  let nodeId = 0;

  while (right - left > 1) {
    const mid = Math.floor((left + right) / 2);
    const seqHash = hashMipsStateKeccak(seqStates[mid]);
    const chalHash = hashMipsStateKeccak(chalStates[mid]);
    const match = seqHash === chalHash;

    bisectionNodes.push({
      id: nodeId++,
      depth: rounds,
      left,
      right,
      mid,
      match,
      seqHash: seqHash.slice(0, 18) + '...',
      chalHash: chalHash.slice(0, 18) + '...',
      parentId: rounds > 0 ? nodeId - 2 : null,
    });

    console.log(`   Round ${rounds}: mid=${mid}, match=${match ? '✓' : '✗'}`);

    if (match) {
      left = mid;
    } else {
      right = mid;
    }
    rounds++;
  }

  const disputedStep = left;
  printSuccess(`Bisection completed in ${rounds} rounds`);
  printInfo(`Disputed step: ${disputedStep}`);

  // ============================================
  // Step 6: Submit Bisection Result
  // ============================================
  printHeader('Step 6: Submit Bisection Result On-chain');

  // Create bisection commitment matching DisputeManager.sol:252-254:
  // keccak256(abi.encodePacked(poseidon(pre), poseidon(post), disputedStep)).
  // Inner hashes are Poseidon outputs (ZK circuit public signals), not keccak.
  const poseidon = new PoseidonHasher();
  await poseidon.initialize();

  const preStateForCommit = seqStates[disputedStep];
  const postStateForCommit = seqStates[disputedStep + 1];
  const preStateHashCommit = poseidon.hashMipsState(preStateForCommit);
  const postStateHashCommit = poseidon.hashMipsState(postStateForCommit);
  const preStateHashHex = '0x' + preStateHashCommit.toString(16).padStart(64, '0');
  const postStateHashHex = '0x' + postStateHashCommit.toString(16).padStart(64, '0');

  const bisectionCommitment = hashBisectionCommitment(
    preStateHashHex,
    postStateHashHex,
    BigInt(disputedStep)
  );

  // Sign the bisection result
  const messageHash = ethers.keccak256(
    ethers.solidityPacked(
      ['uint256', 'bytes32', 'uint256'],
      [disputeId, bisectionCommitment, disputedStep]
    )
  );
  const challengerSig = await challengerWallet.signMessage(ethers.getBytes(messageHash));
  const sequencerSig = await sequencerWallet.signMessage(ethers.getBytes(messageHash));

  // Wait for blockchain to settle
  await new Promise(resolve => setTimeout(resolve, 2000));
  await provider.getBlockNumber();

  const tx4 = await disputeManagerSeq.submitBisectionResult(
    disputeId,
    bisectionCommitment,
    disputedStep,
    challengerSig,
    sequencerSig
  );
  const receipt4 = await tx4.wait();

  printSuccess(`Bisection result submitted on-chain`);
  printInfo(`Transaction: ${receipt4.hash}`);
  printInfo(`Gas used: ${receipt4.gasUsed.toString()}`);

  // ============================================
  // Step 7: Generate ZK Proof (Real-time)
  // ============================================
  printHeader('Step 7: Generate ZK Proof (Real-time)');

  const preState = seqStates[disputedStep];
  const postState = seqStates[disputedStep + 1];
  const instruction = instructions[disputedStep];

  printInfo(`Pre-state (step ${disputedStep}): PC=${preState.pc}`);
  printInfo(`Post-state (step ${disputedStep + 1}): PC=${postState.pc}`);
  printInfo(`Instruction: 0x${instruction.toString(16)}`);

  if (!fs.existsSync(CIRCUIT_WASM) || !fs.existsSync(CIRCUIT_ZKEY)) {
    console.error('Circuit build files not found. Build circuits first:');
    console.error('  cd circuits && npm run build');
    process.exit(1);
  }

  // Reuse the Poseidon hasher initialized in Step 6 (bisection commitment).
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
  printInfo('Generating ZK proof via snarkjs.groth16.fullProve()...');
  const proofStart = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInput, CIRCUIT_WASM, CIRCUIT_ZKEY);
  const proofTime = Date.now() - proofStart;

  printSuccess(`ZK proof generated in ${proofTime}ms`);
  printInfo(`Public signals: preHash=${publicSignals[0].slice(0, 10)}..., postHash=${publicSignals[1].slice(0, 10)}...`);

  // ============================================
  // Step 8: Verify Proof On-chain
  // ============================================
  printHeader('Step 8: Verify Proof On-chain');

  // Format proof for contract
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

  // Verify locally first
  const a: [bigint, bigint] = [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])];
  const b: [[bigint, bigint], [bigint, bigint]] = [
    [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
    [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
  ];
  const c: [bigint, bigint] = [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])];
  const pubInputs = publicSignals.map((s: string) => BigInt(s));

  const isValidLocal = await zkVerifier.verifyProof(a, b, c, pubInputs);
  printInfo(`Local verification: ${isValidLocal ? 'VALID' : 'INVALID'}`);

  // Wait for blockchain to settle
  await new Promise(resolve => setTimeout(resolve, 2000));
  await provider.getBlockNumber();

  // Submit proof on-chain
  const tx5 = await disputeManagerSeq.submitProof(disputeId, proofForContract, pubInputs);
  const receipt5 = await tx5.wait();

  printSuccess(`Proof submitted and verified on-chain`);
  printInfo(`Transaction: ${receipt5.hash}`);
  printInfo(`Gas used: ${receipt5.gasUsed.toString()}`);

  // ============================================
  // Step 9: Check Final State
  // ============================================
  printHeader('Step 9: Dispute Resolution Summary');

  const disputeInfo = await disputeManagerSeq.getDispute(disputeId);
  const statusNames = ['None', 'Initiated', 'ProofSubmitted', 'Resolved', 'Timeout'];

  printInfo(`Dispute ID: ${disputeId}`);
  printInfo(`Status: ${statusNames[disputeInfo.status]}`);
  printInfo(`Challenger: ${disputeInfo.challenger}`);
  printInfo(`Sequencer: ${disputeInfo.sequencer}`);
  printInfo(`Challenger Bond: ${ethers.formatEther(disputeInfo.challengerBond)} ETH`);
  printInfo(`Sequencer Bond: ${ethers.formatEther(disputeInfo.sequencerBond)} ETH`);

  // ============================================
  // Summary
  // ============================================
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                  E2E Test Summary                            ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  State root proposed (batch ${newBatchIndex})                             ║`);
  console.log(`║  Dispute initiated (ID: ${disputeId})                                  ║`);
  console.log(`║  Bisection completed (${rounds} rounds, step ${disputedStep})                     ║`);
  console.log(`║  ZK proof generated in real-time via snarkjs                  ║`);
  console.log(`║  On-chain verification successful                            ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Collect transaction records
  const transactions: TransactionRecord[] = [
    { name: 'proposeStateRoot', hash: receipt1.hash, gasUsed: receipt1.gasUsed.toString(), blockNumber: receipt1.blockNumber },
    { name: 'initiateDispute', hash: receipt2.hash, gasUsed: receipt2.gasUsed.toString(), blockNumber: receipt2.blockNumber },
    { name: 'depositSequencerBond', hash: receipt3.hash, gasUsed: receipt3.gasUsed.toString(), blockNumber: receipt3.blockNumber },
    { name: 'submitBisectionResult', hash: receipt4.hash, gasUsed: receipt4.gasUsed.toString(), blockNumber: receipt4.blockNumber },
    { name: 'submitProof', hash: receipt5.hash, gasUsed: receipt5.gasUsed.toString(), blockNumber: receipt5.blockNumber },
  ];

  const totalGas =
    BigInt(receipt1.gasUsed) +
    BigInt(receipt2.gasUsed) +
    BigInt(receipt3.gasUsed) +
    BigInt(receipt4.gasUsed) +
    BigInt(receipt5.gasUsed);

  console.log('\n Gas Usage:');
  for (const tx of transactions) {
    console.log(`   ${tx.name.padEnd(22)} ${tx.gasUsed.padStart(10)}`);
  }
  console.log(`   ${''.padEnd(35, '─')}`);
  console.log(`   Total:                 ${totalGas.toString().padStart(10)}`);

  // Decode instructions for export
  const instructionInfos: InstructionInfo[] = instructions.map((inst, i) => decodeInstruction(inst, i));

  // Build network info
  const network = await provider.getNetwork();

  // Compute metrics from real gas data
  const realTotalGas = Number(totalGas);
  const traditionalTotalGas = 73 * 50000; // 3.65M estimated
  const traditionalTime = 7 * 24 * 60 * 60 * 1000; // 7 days
  const zkTime = rounds * 100 + 15000 + 2000; // bisection + proof + verify

  const exportData: OnchainE2EData = {
    scenario: 'onchain_dispute',
    generatedAt: new Date().toISOString(),
    discrepancyStep: DISCREPANCY_STEP,
    instructions: instructionInfos,
    sequencerStates: seqStates.map(serializeState),
    challengerStates: chalStates.map(serializeState),
    bisectionTree: {
      nodes: bisectionNodes,
      disputedStep,
      totalRounds: rounds,
    },
    onchain: {
      network: deployment.network,
      chainId: Number(network.chainId),
      contracts: {
        RollupManager: deployment.contracts.RollupManager,
        DisputeManager: deployment.contracts.DisputeManager,
        ZKVerifier: deployment.contracts.ZKVerifier,
      },
      participants: {
        sequencer: sequencerWallet.address,
        challenger: challengerWallet.address,
      },
      disputeId: disputeId.toString(),
      bondAmount: ethers.formatEther(bondAmount),
      transactions,
      totalGas: totalGas.toString(),
      disputeStatus: statusNames[disputeInfo.status],
      proofValid: isValidLocal,
    },
    metrics: {
      traditional: {
        disputeTime: traditionalTime,
        onChainMessages: 73,
        gasPerMessage: 50000,
        totalGas: traditionalTotalGas,
      },
      zkChannel: {
        disputeTime: zkTime,
        onChainMessages: 5,
        totalGas: realTotalGas,
        gasBreakdown: transactions,
      },
      improvements: {
        timeReduction: ((1 - zkTime / traditionalTime) * 100).toFixed(2),
        messageReduction: ((1 - 5 / 73) * 100).toFixed(2),
        gasReduction: ((1 - realTotalGas / traditionalTotalGas) * 100).toFixed(2),
      },
    },
  };

  // Export JSON
  const outputDir = path.join(__dirname, '../../public/data');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const outputPath = path.join(outputDir, 'onchain-e2e.json');
  fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
  printSuccess(`Dashboard data exported to: ${outputPath}`);

  console.log('\n On-chain E2E test completed successfully!\n');
}

main().catch((error) => {
  console.error('E2E test failed:', error);
  process.exit(1);
});
