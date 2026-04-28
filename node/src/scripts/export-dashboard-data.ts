/**
 * SI-RVP - Dashboard Data Export Script
 *
 * Runs the demo and exports real execution data for the dashboard.
 * Usage: npm run export:dashboard [scenario]
 *        npx ts-node src/scripts/export-dashboard-data.ts [scenario] > public/data/output.json
 *
 * Scenarios:
 *   - happy_path: No discrepancy (all states match)
 *   - dispute_early: Discrepancy at step 3
 *   - dispute_late: Discrepancy at step 7
 *   - all: Generate all scenarios
 */

import * as fs from 'fs';
import * as path from 'path';
import { MipsExecutor, MipsInstructionBuilder } from '../common/mips';
import { MipsState } from '../common/types';
import { hashMipsStateKeccak } from '../common/hash';

// ============================================
// Types for Dashboard Export
// ============================================

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

interface DashboardData {
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
      gasPerMessage: number;
      totalGas: number;
    };
    improvements: {
      timeReduction: string;
      messageReduction: string;
      gasReduction: string;
    };
    gasBreakdown: {
      deployment: Array<{ name: string; value: number; color: string }>;
      operations: Array<{ name: string; value: number; color: string }>;
    };
  };
  participants: {
    sequencer: string;
    challenger: string;
  };
}

// ============================================
// Serialize Functions
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

function decodeInstruction(
  encoded: bigint,
  step: number
): Omit<InstructionInfo, 'desc'> {
  const insn = Number(encoded & 0xffffffffn);
  const opcode = (insn >> 26) & 0x3f;
  const func = insn & 0x3f;
  const rs = (insn >> 21) & 0x1f;
  const rt = (insn >> 16) & 0x1f;
  const rd = (insn >> 11) & 0x1f;
  const imm = insn & 0xffff;

  let op = 'UNKNOWN';

  if (opcode === 0) {
    // R-Type
    const rTypeOps: Record<number, string> = {
      0x20: 'ADD',
      0x21: 'ADDU',
      0x22: 'SUB',
      0x23: 'SUBU',
      0x24: 'AND',
      0x25: 'OR',
      0x26: 'XOR',
      0x27: 'NOR',
      0x2a: 'SLT',
      0x2b: 'SLTU',
      0x00: 'SLL',
      0x02: 'SRL',
      0x03: 'SRA',
      0x08: 'JR',
      0x09: 'JALR',
    };
    op = rTypeOps[func] || `R(${func.toString(16)})`;
    return { step, op, rd, rs, rt, encoded: '0x' + encoded.toString(16) };
  } else {
    // I-Type
    const iTypeOps: Record<number, string> = {
      0x08: 'ADDI',
      0x09: 'ADDIU',
      0x0c: 'ANDI',
      0x0d: 'ORI',
      0x0e: 'XORI',
      0x0f: 'LUI',
      0x0a: 'SLTI',
      0x0b: 'SLTIU',
      0x04: 'BEQ',
      0x05: 'BNE',
      0x23: 'LW',
      0x2b: 'SW',
    };
    op = iTypeOps[opcode] || `I(${opcode.toString(16)})`;
    return {
      step,
      op,
      rd: rt,
      rs,
      imm: imm > 0x7fff ? imm - 0x10000 : imm,
      encoded: '0x' + encoded.toString(16),
    };
  }
}

function generateDescription(info: Omit<InstructionInfo, 'desc'>): string {
  const { op, rd, rs, rt, imm } = info;
  const rName = (r: number | undefined) => (r !== undefined ? `r${r}` : '?');

  switch (op) {
    case 'ADDI':
    case 'ADDIU':
      return `${rName(rd)} = ${rName(rs)} + ${imm}`;
    case 'ADD':
    case 'ADDU':
      return `${rName(rd)} = ${rName(rs)} + ${rName(rt)}`;
    case 'SUB':
    case 'SUBU':
      return `${rName(rd)} = ${rName(rs)} - ${rName(rt)}`;
    case 'AND':
      return `${rName(rd)} = ${rName(rs)} & ${rName(rt)}`;
    case 'OR':
      return `${rName(rd)} = ${rName(rs)} | ${rName(rt)}`;
    case 'XOR':
      return `${rName(rd)} = ${rName(rs)} ^ ${rName(rt)}`;
    case 'SLT':
    case 'SLTU':
      return `${rName(rd)} = (${rName(rs)} < ${rName(rt)}) ? 1 : 0`;
    case 'LUI':
      return `${rName(rd)} = ${imm} << 16`;
    default:
      return `${op} ${rName(rd)}, ${rName(rs)}, ${rt !== undefined ? rName(rt) : imm}`;
  }
}

// ============================================
// Main Export Function
// ============================================

function loadOnchainData(): Record<string, unknown> | null {
  const onchainPath = path.join(__dirname, '../../public/data/onchain-e2e.json');
  if (!fs.existsSync(onchainPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(onchainPath, 'utf-8'));
  } catch {
    return null;
  }
}

function generateDashboardData(scenario: string): DashboardData {
  const onchainData = loadOnchainData();
  const mipsExecutor = new MipsExecutor();

  // Define instructions
  const instructions: bigint[] = [
    MipsInstructionBuilder.addi(1, 0, 100), // r1 = 100
    MipsInstructionBuilder.addi(2, 0, 50), // r2 = 50
    MipsInstructionBuilder.add(3, 1, 2), // r3 = r1 + r2 = 150
    MipsInstructionBuilder.sub(4, 1, 2), // r4 = r1 - r2 = 50
    MipsInstructionBuilder.and(5, 1, 2), // r5 = r1 & r2 = 32
    MipsInstructionBuilder.or(6, 1, 2), // r6 = r1 | r2 = 118
    MipsInstructionBuilder.slt(7, 2, 1), // r7 = (r2 < r1) = 1
    MipsInstructionBuilder.addi(8, 3, 10), // r8 = r3 + 10 = 160
    MipsInstructionBuilder.addi(9, 4, 20), // r9 = r4 + 20 = 70
    MipsInstructionBuilder.add(10, 8, 9), // r10 = r8 + r9 = 230
  ];

  // Decode instructions
  const instructionInfos: InstructionInfo[] = instructions.map((inst, i) => {
    const info = decodeInstruction(inst, i);
    return { ...info, desc: generateDescription(info) };
  });

  // Determine discrepancy step
  const discrepancyStep =
    scenario === 'happy_path' ? -1 : scenario === 'dispute_early' ? 3 : 7;

  // Execute for sequencer (always correct)
  let seqState = MipsExecutor.createInitialState();
  const sequencerStates: MipsState[] = [
    { ...seqState, registers: [...seqState.registers] },
  ];

  for (const instruction of instructions) {
    seqState = mipsExecutor.executeStep(seqState, instruction);
    sequencerStates.push({ ...seqState, registers: [...seqState.registers] });
  }

  // Execute for challenger (with possible discrepancy)
  let chalState = MipsExecutor.createInitialState();
  const challengerStates: MipsState[] = [
    { ...chalState, registers: [...chalState.registers] },
  ];

  for (let i = 0; i < instructions.length; i++) {
    chalState = mipsExecutor.executeStep(chalState, instructions[i]);

    // Introduce discrepancy
    if (i === discrepancyStep) {
      chalState = { ...chalState, registers: [...chalState.registers] };
      chalState.registers[instructionInfos[i].rd!] = 999n;
    }

    challengerStates.push({
      ...chalState,
      registers: [...chalState.registers],
    });
  }

  // Perform bisection
  const bisectionNodes: BisectionNode[] = [];
  let nodeId = 0;
  let totalRounds = 0;

  function runBisection(
    left: number,
    right: number,
    depth: number,
    parentId: number | null
  ): number {
    if (right - left <= 1 || depth > 15) {
      return left;
    }

    const mid = Math.floor((left + right) / 2);
    const seqHash = hashMipsStateKeccak(sequencerStates[mid]);
    const chalHash = hashMipsStateKeccak(challengerStates[mid]);
    const match = seqHash === chalHash;

    const node: BisectionNode = {
      id: nodeId++,
      depth,
      left,
      right,
      mid,
      match,
      seqHash: seqHash.slice(0, 18) + '...',
      chalHash: chalHash.slice(0, 18) + '...',
      parentId,
    };
    bisectionNodes.push(node);
    totalRounds++;

    if (match) {
      return runBisection(mid, right, depth + 1, node.id);
    } else {
      return runBisection(left, mid, depth + 1, node.id);
    }
  }

  let disputedStep = -1;
  if (discrepancyStep !== -1) {
    disputedStep = runBisection(0, sequencerStates.length - 1, 0, null);
  }

  // Generate metrics
  const onchain = onchainData?.onchain as Record<string, unknown> | undefined;
  const onchainTxs = (onchain?.transactions as Array<{ name: string; gasUsed: string }>) || [];
  const realTotalGas = onchain ? Number(onchain.totalGas) : null;
  const realTxCount = onchainTxs.length;

  const traditional = {
    disputeTime: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    onChainMessages: 73,
    gasPerMessage: 50000,
    totalGas: 73 * 50000,
  };

  const disputeTotalGas = realTotalGas ?? 750000;
  const disputeTxCount = realTxCount || 3;

  const zkChannel = {
    disputeTime:
      scenario === 'happy_path' ? 0 : totalRounds * 100 + 15000 + 2000,
    onChainMessages: scenario === 'happy_path' ? 1 : disputeTxCount,
    gasPerMessage: scenario === 'happy_path' ? 50000 : Math.round(disputeTotalGas / disputeTxCount),
    totalGas: scenario === 'happy_path' ? 50000 : disputeTotalGas,
  };

  const improvements = {
    timeReduction: (
      ((traditional.disputeTime - zkChannel.disputeTime) /
        traditional.disputeTime) *
      100
    ).toFixed(2),
    messageReduction: (
      ((traditional.onChainMessages - zkChannel.onChainMessages) /
        traditional.onChainMessages) *
      100
    ).toFixed(2),
    gasReduction: (
      ((traditional.totalGas - zkChannel.totalGas) / traditional.totalGas) *
      100
    ).toFixed(2),
  };

  // Build operations gas breakdown from real data if available
  const opColors = ['#10b981', '#3b82f6', '#f59e0b', '#f43f5e', '#8b5cf6', '#06b6d4', '#ec4899'];
  const operations = onchainTxs.length > 0
    ? onchainTxs.map((tx, i) => ({
        name: tx.name,
        value: Number(tx.gasUsed),
        color: opColors[i % opColors.length],
      }))
    : [
        { name: 'proposeStateRoot', value: 45000, color: '#10b981' },
        { name: 'initiateDispute', value: 120000, color: '#3b82f6' },
        { name: 'submitProof', value: 350000, color: '#f59e0b' },
        { name: 'resolveDispute', value: 80000, color: '#f43f5e' },
      ];

  // Use real participant addresses if available
  const onchainParticipants = onchain?.participants as { sequencer: string; challenger: string } | undefined;
  const participants = onchainParticipants
    ? { sequencer: onchainParticipants.sequencer, challenger: onchainParticipants.challenger }
    : { sequencer: '0x7a69F4D12E3b45aC8192bE54f1eD34e09A123456', challenger: '0x8b5cF9D23A4c56bD9283cF65e2aB45f0B987654' };

  // Assemble final data
  const data: DashboardData = {
    scenario,
    generatedAt: new Date().toISOString(),
    discrepancyStep,
    instructions: instructionInfos,
    sequencerStates: sequencerStates.map(serializeState),
    challengerStates: challengerStates.map(serializeState),
    bisectionTree: {
      nodes: bisectionNodes,
      disputedStep,
      totalRounds,
    },
    metrics: {
      traditional,
      zkChannel,
      improvements,
      gasBreakdown: {
        deployment: [
          { name: 'Groth16Verifier', value: 2500, color: '#10b981' },
          { name: 'ZKVerifier', value: 800, color: '#3b82f6' },
          { name: 'RollupManager', value: 1200, color: '#f59e0b' },
          { name: 'DisputeManager', value: 900, color: '#f43f5e' },
        ],
        operations,
      },
    },
    participants,
  };

  return data;
}

// ============================================
// Main
// ============================================

const scenario = process.argv[2] || 'dispute_early';

if (scenario === 'all') {
  const allData: Record<string, DashboardData> = {};
  for (const s of ['happy_path', 'dispute_early', 'dispute_late']) {
    allData[s] = generateDashboardData(s);
  }
  console.log(JSON.stringify(allData, null, 2));
} else {
  const data = generateDashboardData(scenario);
  console.log(JSON.stringify(data, null, 2));
}
