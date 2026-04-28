/**
 * Shared mock factories for sequencer/challenger unit tests.
 *
 * Only external I/O dependencies are mocked (contracts, P2P, ZKProver, PoseidonHasher).
 * Pure-logic dependencies (MipsExecutor, BisectionProtocol, ChannelManager) use real instances.
 */

import { ethers } from 'ethers';
import { MipsState, ZKProof, DisputeConfig, DEFAULT_CONFIG } from '../../src/common/types';
import { DisputeInfo, DisputeStatus } from '../../src/common/contracts';

// ============================================
// Dummy ZKProof
// ============================================

export function createDummyZKProof(): ZKProof {
  return {
    proof: {
      a: ['0x1', '0x2'],
      b: [['0x3', '0x4'], ['0x5', '0x6']],
      c: ['0x7', '0x8'],
    },
    publicInputs: ['0x1111', '0x2222', '0x3333'],
  };
}

// ============================================
// Dummy DisputeInfo
// ============================================

export function createMockDisputeInfo(overrides: Partial<DisputeInfo> = {}): DisputeInfo {
  return {
    batchIndex: 1n,
    challenger: ethers.ZeroAddress,
    sequencer: ethers.ZeroAddress,
    challengerClaim: ethers.ZeroHash,
    sequencerClaim: ethers.ZeroHash,
    challengerBond: DEFAULT_CONFIG.bondAmount,
    sequencerBond: DEFAULT_CONFIG.bondAmount,
    createdAt: BigInt(Math.floor(Date.now() / 1000)),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    bisectionCommitment: ethers.ZeroHash,
    status: DisputeStatus.Initiated,
    resolvedAt: 0n,
    l1Head: ethers.ZeroHash,
    ...overrides,
  };
}

// ============================================
// RollupManagerClient Mock
// ============================================

export interface MockRollupManager {
  proposeStateRoot: (stateRoot: string, batchIndex: bigint) => Promise<string>;
  removeAllListeners: () => void;
  onStateRootProposed: (cb: (...args: any[]) => void) => void;
  _stateRootProposedCb?: (...args: any[]) => void;
  _calls: { method: string; args: any[] }[];
}

export function createMockRollupManager(): MockRollupManager {
  const mock: MockRollupManager = {
    _calls: [],
    async proposeStateRoot(stateRoot: string, batchIndex: bigint) {
      mock._calls.push({ method: 'proposeStateRoot', args: [stateRoot, batchIndex] });
      return '0xtxhash_propose';
    },
    removeAllListeners() {
      mock._calls.push({ method: 'removeAllListeners', args: [] });
    },
    onStateRootProposed(cb) {
      mock._stateRootProposedCb = cb;
      mock._calls.push({ method: 'onStateRootProposed', args: [cb] });
    },
  };
  return mock;
}

// ============================================
// DisputeManagerClient Mock
// ============================================

export interface MockDisputeManager {
  getDispute: (disputeId: bigint) => Promise<DisputeInfo>;
  getRequiredBond: () => Promise<bigint>;
  depositSequencerBond: (disputeId: bigint, bond: bigint) => Promise<string>;
  initiateDispute: (batchIndex: bigint, claimedStateRoot: string, bond: bigint) => Promise<bigint>;
  submitProof: (disputeId: bigint, zkProof: ZKProof) => Promise<string>;
  resolveDispute: (disputeId: bigint) => Promise<string>;
  triggerTimeout: (disputeId: bigint) => Promise<string>;
  onDisputeInitiated: (cb: (...args: any[]) => void) => void;
  onProofSubmitted: (cb: (...args: any[]) => void) => void;
  onDisputeResolved: (cb: (...args: any[]) => void) => void;
  removeAllListeners: () => void;
  _disputeInitiatedCb?: (...args: any[]) => void;
  _proofSubmittedCb?: (...args: any[]) => void;
  _disputeResolvedCb?: (...args: any[]) => void;
  _disputeInfo: DisputeInfo;
  _nextDisputeId: bigint;
  _calls: { method: string; args: any[] }[];
}

export function createMockDisputeManager(disputeInfo?: DisputeInfo): MockDisputeManager {
  const mock: MockDisputeManager = {
    _disputeInfo: disputeInfo || createMockDisputeInfo(),
    _nextDisputeId: 1n,
    _calls: [],
    async getDispute(disputeId: bigint) {
      mock._calls.push({ method: 'getDispute', args: [disputeId] });
      return mock._disputeInfo;
    },
    async getRequiredBond() {
      mock._calls.push({ method: 'getRequiredBond', args: [] });
      return DEFAULT_CONFIG.bondAmount;
    },
    async depositSequencerBond(disputeId: bigint, bond: bigint) {
      mock._calls.push({ method: 'depositSequencerBond', args: [disputeId, bond] });
      return '0xtxhash_bond';
    },
    async initiateDispute(batchIndex: bigint, claimedStateRoot: string, bond: bigint) {
      mock._calls.push({ method: 'initiateDispute', args: [batchIndex, claimedStateRoot, bond] });
      return mock._nextDisputeId++;
    },
    async submitProof(disputeId: bigint, zkProof: ZKProof) {
      mock._calls.push({ method: 'submitProof', args: [disputeId, zkProof] });
      return '0xtxhash_proof';
    },
    async resolveDispute(disputeId: bigint) {
      mock._calls.push({ method: 'resolveDispute', args: [disputeId] });
      return '0xtxhash_resolve';
    },
    async triggerTimeout(disputeId: bigint) {
      mock._calls.push({ method: 'triggerTimeout', args: [disputeId] });
      return '0xtxhash_timeout';
    },
    onDisputeInitiated(cb) {
      mock._disputeInitiatedCb = cb;
      mock._calls.push({ method: 'onDisputeInitiated', args: [cb] });
    },
    onProofSubmitted(cb) {
      mock._proofSubmittedCb = cb;
      mock._calls.push({ method: 'onProofSubmitted', args: [cb] });
    },
    onDisputeResolved(cb) {
      mock._disputeResolvedCb = cb;
      mock._calls.push({ method: 'onDisputeResolved', args: [cb] });
    },
    removeAllListeners() {
      mock._calls.push({ method: 'removeAllListeners', args: [] });
    },
  };
  return mock;
}

// ============================================
// P2PNode Mock
// ============================================

export interface SentMessage {
  to: string;
  type: string;
  payload: any;
}

export interface MockP2PNode {
  startServer: (port: number) => void;
  connect: (url: string, address: string) => Promise<void>;
  send: (to: string, type: string, payload: any) => Promise<void>;
  close: () => void;
  isConnected: (address: string) => boolean;
  _sent: SentMessage[];
  _connected: Set<string>;
  _serverPort?: number;
  _calls: { method: string; args: any[] }[];
}

export function createMockP2PNode(): MockP2PNode {
  const mock: MockP2PNode = {
    _sent: [],
    _connected: new Set(),
    _calls: [],
    startServer(port: number) {
      mock._serverPort = port;
      mock._calls.push({ method: 'startServer', args: [port] });
    },
    async connect(url: string, address: string) {
      mock._connected.add(address);
      mock._calls.push({ method: 'connect', args: [url, address] });
    },
    async send(to: string, type: string, payload: any) {
      mock._sent.push({ to, type, payload });
      mock._calls.push({ method: 'send', args: [to, type, payload] });
    },
    close() {
      mock._connected.clear();
      mock._calls.push({ method: 'close', args: [] });
    },
    isConnected(address: string) {
      return mock._connected.has(address);
    },
  };
  return mock;
}

// ============================================
// ZKProver Mock
// ============================================

export interface MockZKProver {
  initialize: () => Promise<void>;
  generateProof: (input: any) => Promise<ZKProof>;
  _initialized: boolean;
  _calls: { method: string; args: any[] }[];
}

export function createMockZKProver(): MockZKProver {
  const mock: MockZKProver = {
    _initialized: false,
    _calls: [],
    async initialize() {
      mock._initialized = true;
      mock._calls.push({ method: 'initialize', args: [] });
    },
    async generateProof(input: any) {
      mock._calls.push({ method: 'generateProof', args: [input] });
      return createDummyZKProof();
    },
  };
  return mock;
}

// ============================================
// PoseidonHasher Mock (keccak256-based)
// ============================================

export interface MockPoseidonHasher {
  initialize: () => Promise<void>;
  hashMipsState: (state: MipsState) => bigint;
  hash: (inputs: bigint[]) => bigint;
  _initialized: boolean;
  _calls: { method: string; args: any[] }[];
}

export function createMockPoseidonHasher(): MockPoseidonHasher {
  const mock: MockPoseidonHasher = {
    _initialized: false,
    _calls: [],
    async initialize() {
      mock._initialized = true;
      mock._calls.push({ method: 'initialize', args: [] });
    },
    hashMipsState(state: MipsState) {
      mock._calls.push({ method: 'hashMipsState', args: [state] });
      const encoded = ethers.solidityPacked(
        ['uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
        [state.pc, state.nextPC, state.hi, state.lo, state.step]
      );
      const h = ethers.keccak256(encoded);
      return BigInt(h) & ((1n << 253n) - 1n);
    },
    hash(inputs: bigint[]) {
      mock._calls.push({ method: 'hash', args: [inputs] });
      const encoded = ethers.solidityPacked(
        inputs.map(() => 'uint256'),
        inputs
      );
      const h = ethers.keccak256(encoded);
      return BigInt(h) & ((1n << 253n) - 1n);
    },
  };
  return mock;
}

// ============================================
// Config Factories
// ============================================

export function createSequencerConfig() {
  const wallet = ethers.Wallet.createRandom();
  return {
    config: {
      privateKey: wallet.privateKey,
      rpcUrl: 'http://127.0.0.1:8545',
      rollupManagerAddress: ethers.ZeroAddress,
      disputeManagerAddress: ethers.ZeroAddress,
      p2pPort: 9999,
    },
    wallet,
  };
}

export function createChallengerConfig(sequencerAddress?: string) {
  const wallet = ethers.Wallet.createRandom();
  return {
    config: {
      privateKey: wallet.privateKey,
      rpcUrl: 'http://127.0.0.1:8545',
      rollupManagerAddress: ethers.ZeroAddress,
      disputeManagerAddress: ethers.ZeroAddress,
      sequencerP2PUrl: 'ws://localhost:9000',
      sequencerAddress: sequencerAddress || ethers.ZeroAddress,
    },
    wallet,
  };
}

// ============================================
// All-in-one mock set creation
// ============================================

export function createSequencerMocks(disputeInfo?: DisputeInfo) {
  return {
    rollupManager: createMockRollupManager(),
    disputeManager: createMockDisputeManager(disputeInfo),
    p2pNode: createMockP2PNode(),
    zkProver: createMockZKProver(),
    poseidonHasher: createMockPoseidonHasher(),
  };
}

export function createChallengerMocks(disputeInfo?: DisputeInfo) {
  return {
    rollupManager: createMockRollupManager(),
    disputeManager: createMockDisputeManager(disputeInfo),
    p2pNode: createMockP2PNode(),
    poseidonHasher: createMockPoseidonHasher(),
  };
}
