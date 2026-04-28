/**
 * SI-RVP - Common Type Definitions
 * Data structures compatible with Cannon FPVM (MIPS64.sol)
 *
 * Reference: optimism/packages/contracts-bedrock/src/cannon/MIPS64.sol
 */

// ============================================
// Optimism-compatible branded types (Phase 7)
// ============================================

/**
 * GameType — branded uint32 identifying a dispute game type
 * Mirrors Solidity: type GameType is uint32
 */
export type GameType = number & { readonly __brand: 'GameType' };

/** Create a GameType value */
export function gameType(value: number): GameType {
  return value as GameType;
}

/** Well-known game types */
export const GameTypes = {
  CANNON: gameType(0),
  PERMISSIONED_CANNON: gameType(1),
  ASTERISC: gameType(2),
  ZK_CANNON: gameType(255),
} as const;

/**
 * Claim — branded bytes32 representing a state root claim
 * Mirrors Solidity: type Claim is bytes32
 */
export type Claim = string & { readonly __brand: 'Claim' };

/** Create a Claim value from a bytes32 hex string */
export function claim(value: string): Claim {
  return value as Claim;
}

/**
 * GameStatus — matches Solidity enum
 */
export enum GameStatus {
  IN_PROGRESS = 0,
  CHALLENGER_WINS = 1,
  DEFENDER_WINS = 2,
}

/**
 * DisputeGameCreated event data
 */
export interface DisputeGameCreatedEvent {
  proxy: string;
  gameType: GameType;
  rootClaim: Claim;
  l2BlockNumber: bigint;
  extraData: string;
}

// ============================================
// VM Status (Cannon compatible)
// ============================================
export enum VMStatus {
  VALID = 0,      // Execution succeeded, result valid
  INVALID = 1,    // Execution succeeded, result invalid
  PANIC = 2,      // VM panic
  UNFINISHED = 3, // Execution not finished
}

// ============================================
// Thread State (see MIPS64.sol:28-39)
// ============================================
export interface ThreadState {
  threadID: bigint;
  exitCode: number;
  exited: boolean;
  pc: bigint;
  nextPC: bigint;
  lo: bigint;
  hi: bigint;
  registers: bigint[]; // 32개
}

// ============================================
// VM State (see MIPS64.sol:50-66)
// ============================================
export interface VMState {
  memRoot: string;              // bytes32
  preimageKey: string;          // bytes32
  preimageOffset: bigint;       // uint64
  heap: bigint;                 // uint64
  llReservationStatus: number;  // uint8 (0=none, 1=32bit, 2=64bit)
  llAddress: bigint;            // uint64
  llOwnerThread: bigint;        // uint64
  exitCode: number;             // uint8
  exited: boolean;
  step: bigint;                 // uint64
  stepsSinceLastContextSwitch: bigint;
  traverseRight: boolean;
  leftThreadStack: string;      // bytes32
  rightThreadStack: string;     // bytes32
  nextThreadID: bigint;         // uint64
}

/**
 * Describes a memory write produced by a store instruction (SW/SH/SB).
 */
export interface MemoryWriteDescriptor {
  address: bigint;
  value: bigint;
  size: 1 | 2 | 4;
}

/**
 * MIPS CPU State (simplified version)
 * For POC - includes only core fields from ThreadState + VMState
 */
export interface MipsState {
  /** Program Counter */
  pc: bigint;
  /** Next PC (branch delay slot) */
  nextPC: bigint;
  /** 32 general purpose registers */
  registers: bigint[];
  /** HI register (upper 32 bits of MUL/DIV) */
  hi: bigint;
  /** LO register (lower 32 bits of MUL/DIV) */
  lo: bigint;
  /** Heap pointer */
  heap: bigint;
  /** Exit code (when execution completes) */
  exitCode: number;
  /** Whether execution has exited */
  exited: boolean;
  /** Current execution step */
  step: bigint;
  /** Memory Merkle root */
  memoryRoot: string;
  /** Preimage key (for memory access) */
  preimageKey: string;
  /** Preimage offset */
  preimageOffset: bigint;
  /** Memory write descriptor (set by store instructions) */
  memWrite?: MemoryWriteDescriptor;
}

/**
 * State commitment (Merkle root based)
 */
export interface StateCommitment {
  /** State hash */
  stateHash: string;
  /** Step index */
  step: bigint;
  /** Commitment signature */
  signature?: string;
}

/**
 * Bisection protocol message
 */
export interface BisectionMove {
  /** Message type */
  type: 'attack' | 'defend';
  /** Dispute ID */
  disputeId: string;
  /** Current depth (0-72) */
  depth: number;
  /** Dispute position (step index) */
  position: bigint;
  /** State commitment at this position */
  claim: StateCommitment;
  /** Sender signature */
  signature: string;
  /** Timestamp */
  timestamp: number;
}

/**
 * Channel state
 */
export interface ChannelState {
  /** Channel ID (= Dispute ID) */
  channelId: string;
  /** Sequencer address */
  sequencer: string;
  /** Challenger address */
  challenger: string;
  /** Current depth */
  currentDepth: number;
  /** Maximum depth (Cannon: 73) */
  maxDepth: number;
  /** Dispute start step */
  startStep: bigint;
  /** Dispute end step */
  endStep: bigint;
  /** Move history */
  moves: BisectionMove[];
  /** Channel status */
  status: 'open' | 'bisecting' | 'awaiting_proof' | 'closed';
  /** Creation time */
  createdAt: number;
  /** Last activity time */
  lastActivityAt: number;
}

/**
 * ZK proof data
 */
export interface ZKProof {
  /** Groth16 proof */
  proof: {
    a: [string, string];
    b: [[string, string], [string, string]];
    c: [string, string];
  };
  /** Public inputs */
  publicInputs: string[];
}

/**
 * Dispute result
 */
export interface DisputeResult {
  /** Dispute ID */
  disputeId: string;
  /** Winner ('sequencer' | 'challenger') */
  winner: 'sequencer' | 'challenger';
  /** Disputed step index */
  disputedStep: bigint;
  /** Whether ZK proof is valid */
  proofValid: boolean;
  /** Reward amount (wei) */
  reward: bigint;
  /** Completion time */
  completedAt: number;
}

/**
 * P2P message wrapper
 */
export interface P2PMessage {
  /** Message type */
  type: 'channel_open' | 'channel_ack' | 'bisection_move' | 'proof_request' | 'proof_submit' | 'channel_close';
  /** Payload */
  payload: unknown;
  /** Sender */
  from: string;
  /** Recipient */
  to: string;
  /** Signature */
  signature: string;
  /** Timestamp */
  timestamp: number;
  /** Monotonic sequence number per sender (anti-replay nonce) */
  sequence: number;
}

/**
 * MIPS instruction type
 */
export enum MipsOpcode {
  // R-Type (opcode = 0)
  ADD = 0x20,
  ADDU = 0x21,
  SUB = 0x22,
  SUBU = 0x23,
  AND = 0x24,
  OR = 0x25,
  XOR = 0x26,
  NOR = 0x27,
  SLT = 0x2a,
  SLTU = 0x2b,
  SLL = 0x00,
  SRL = 0x02,
  SRA = 0x03,
  JR = 0x08,

  // I-Type
  ADDI = 0x08,
  ADDIU = 0x09,
  ANDI = 0x0c,
  ORI = 0x0d,
  XORI = 0x0e,
  LUI = 0x0f,
  LW = 0x23,
  SW = 0x2b,
  BEQ = 0x04,
  BNE = 0x05,

  // J-Type
  J = 0x02,
  JAL = 0x03,
}

/**
 * Dispute manager configuration
 */
export interface DisputeConfig {
  /** Required bond (wei) */
  bondAmount: bigint;
  /** Bisection timeout (seconds) */
  bisectionTimeout: number;
  /** Proof submission timeout (seconds) */
  proofTimeout: number;
  /** Maximum depth */
  maxDepth: number;
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: DisputeConfig = {
  bondAmount: BigInt('10000000000000000'), // 0.01 ETH
  bisectionTimeout: 60, // 60 seconds
  proofTimeout: 3600, // 1 hour
  maxDepth: 73, // Cannon default
};

// ============================================
// Position (see FaultDisputeGame.sol)
// ============================================

/**
 * Generalized Index based Position
 * - gindex of node at depth d, index i = 2^d + i
 * - root has gindex = 1
 */
export interface Position {
  gindex: bigint;
}

/**
 * Position utility functions
 */
export const PositionLib = {
  /** Root Position */
  ROOT: { gindex: 1n } as Position,

  /** Calculate depth */
  depth(pos: Position): number {
    if (pos.gindex === 0n) return 0;
    return Math.floor(Math.log2(Number(pos.gindex)));
  },

  /** Calculate index at depth */
  indexAtDepth(pos: Position): bigint {
    const d = PositionLib.depth(pos);
    return pos.gindex - (1n << BigInt(d));
  },

  /** Left child */
  left(pos: Position): Position {
    return { gindex: pos.gindex * 2n };
  },

  /** Right child */
  right(pos: Position): Position {
    return { gindex: pos.gindex * 2n + 1n };
  },

  /** Parent */
  parent(pos: Position): Position {
    return { gindex: pos.gindex / 2n };
  },

  /** Attack move (left child) */
  attack(pos: Position): Position {
    return PositionLib.left(pos);
  },

  /** Defend move (right child) */
  defend(pos: Position): Position {
    return PositionLib.right(pos);
  },

  /** Calculate trace index (execution range covered by this position) */
  traceIndex(pos: Position, maxDepth: number): bigint {
    const d = PositionLib.depth(pos);
    const remaining = BigInt(maxDepth - d);
    return (pos.gindex << remaining) - (1n << BigInt(maxDepth));
  },
};

// ============================================
// Claim Data (see FaultDisputeGame.sol:79-87)
// ============================================
export interface ClaimData {
  parentIndex: number;
  counteredBy: string;   // address
  claimant: string;      // address
  bond: bigint;          // uint128
  claim: string;         // bytes32 (state hash)
  position: Position;
  clock: bigint;         // packed Clock (timestamp + duration)
}

// ============================================
// State hash utilities
// ============================================
export interface StateHashInput {
  pc: bigint;
  nextPC: bigint;
  lo: bigint;
  hi: bigint;
  registers: bigint[];
  memRoot: string;
  step: bigint;
}

// ============================================
// Channel protocol message types
// ============================================
export type ChannelMessageType =
  | 'CHANNEL_OPEN'
  | 'CHANNEL_ACK'
  | 'BISECTION_CLAIM'
  | 'BISECTION_CHALLENGE'
  | 'PROOF_REQUEST'
  | 'PROOF_SUBMIT'
  | 'TIMEOUT_CLAIM'
  | 'CHANNEL_CLOSE';

export interface ChannelMessage<T = unknown> {
  type: ChannelMessageType;
  channelId: string;
  sequence: number;
  payload: T;
  sender: string;
  signature: string;
  timestamp: number;
}

// ============================================
// Bisection state machine
// ============================================
export enum BisectionPhase {
  IDLE = 'IDLE',
  SEQUENCER_TURN = 'SEQUENCER_TURN',
  CHALLENGER_TURN = 'CHALLENGER_TURN',
  AWAITING_PROOF = 'AWAITING_PROOF',
  RESOLVED = 'RESOLVED',
  TIMEOUT = 'TIMEOUT',
}

export interface BisectionState {
  disputeId: string;
  phase: BisectionPhase;
  currentDepth: number;
  sequencerClaims: Map<string, ClaimData>; // position -> claim
  challengerClaims: Map<string, ClaimData>;
  agreedPrefix: bigint;    // Agreed starting step
  disputedClaim: bigint;   // Step under dispute
  turnDeadline: number;    // Current turn deadline
}
