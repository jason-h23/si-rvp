/**
 * SI-RVP - Contract Interaction Layer
 *
 * Contract interface based on ethers.js v6
 */

import { ethers, Contract, Wallet, Provider } from 'ethers';
import { ZKProof, GameType, Claim, DisputeGameCreatedEvent } from './types';

// ============================================
// Contract ABIs (core functions only)
// ============================================

const ROLLUP_MANAGER_ABI = [
  'function proposeStateRoot(bytes32 stateRoot, uint256 batchIndex) external',
  'function getBatch(uint256 batchIndex) external view returns (tuple(bytes32 stateRoot, bytes32 prevStateRoot, uint256 timestamp, address proposer, uint8 status))',
  'function latestBatchIndex() external view returns (uint256)',
  'function latestFinalizedBatchIndex() external view returns (uint256)',
  'function finalizeBatch(uint256 batchIndex) external',
  'function CHALLENGE_PERIOD() external view returns (uint256)',
  'event StateRootProposed(uint256 indexed batchIndex, bytes32 stateRoot, bytes32 prevStateRoot, address indexed proposer)',
  'event BatchFinalized(uint256 indexed batchIndex, bytes32 stateHash)',
  'event BatchRejected(uint256 indexed batchIndex, bytes32 stateHash)',
];

const DISPUTE_MANAGER_ABI = [
  'function initiateDispute(uint256 batchIndex, bytes32 claimedStateRoot) external payable returns (uint256 disputeId)',
  'function submitBisectionResult(uint256 disputeId, bytes32 bisectionCommitment, uint256 disputedStep, bytes calldata challengerSig, bytes calldata sequencerSig) external',
  'function submitProof(uint256 disputeId, uint256[8] calldata proof, uint256[] calldata publicInputs) external',
  'function resolveDispute(uint256 disputeId) external',
  'function triggerTimeout(uint256 disputeId) external',
  'function getDispute(uint256 disputeId) external view returns (tuple(uint256 batchIndex, address challenger, address sequencer, bytes32 challengerClaim, bytes32 sequencerClaim, uint256 challengerBond, uint256 sequencerBond, uint256 createdAt, uint256 deadline, bytes32 bisectionCommitment, uint8 status, uint256 resolvedAt, bytes32 l1Head))',
  'function depositSequencerBond(uint256 disputeId) external payable',
  'function requiredBond() external view returns (uint256)',
  'function activeDisputes(uint256 batchIndex) external view returns (uint256)',
  'function BOND_AMOUNT() external view returns (uint256)',
  'function PROOF_DEADLINE() external view returns (uint256)',
  'function BISECTION_DEADLINE() external view returns (uint256)',
  'event DisputeInitiated(uint256 indexed disputeId, uint256 indexed batchIndex, address indexed challenger, bytes32 challengerClaim)',
  'event BisectionCompleted(uint256 indexed disputeId, bytes32 bisectionCommitment, uint256 disputedStep)',
  'event ProofSubmitted(uint256 indexed disputeId, address indexed submitter, bool proofValid)',
  'event DisputeResolved(uint256 indexed disputeId, address indexed winner, uint256 reward)',
  'event DisputeTimeout(uint256 indexed disputeId)',
];

const DISPUTE_GAME_FACTORY_ABI = [
  'function setImplementation(uint32 gameType, address implementation) external',
  'function create(uint32 gameType, bytes32 rootClaim, uint256 l2BlockNumber, bytes calldata extraData) external payable returns (address proxy)',
  'function games(uint32 gameType, bytes32 rootClaim, bytes calldata extraData) external view returns (address proxy)',
  'function gameCount() external view returns (uint256)',
  'function gameAtIdx(uint256 index) external view returns (address proxy)',
  'function implementations(uint32 gameType) external view returns (address)',
  'event DisputeGameCreated(address indexed proxy, uint32 indexed gameType, bytes32 indexed rootClaim, uint256 l2BlockNumber, bytes extraData)',
  'event ImplementationSet(uint32 indexed gameType, address indexed implementation)',
];

const ZK_VERIFIER_ABI = [
  'function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[] calldata publicInputs) external view returns (bool)',
  'function verifyProofFixed(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[3] calldata pubSignals) external view returns (bool)',
];

// ============================================
// Batch Status Enum
// ============================================
export enum BatchStatus {
  Pending = 0,
  Finalized = 1,
  Disputed = 2,
  Rejected = 3,
}

// ============================================
// Dispute Status Enum
// ============================================
export enum DisputeStatus {
  None = 0,
  Initiated = 1,
  ProofSubmitted = 2,
  Resolved = 3,
  Timeout = 4,
}

// ============================================
// Type Definitions
// ============================================
export interface BatchInfo {
  stateRoot: string;
  prevStateRoot: string;
  timestamp: bigint;
  proposer: string;
  status: BatchStatus;
}

export interface DisputeInfo {
  batchIndex: bigint;
  challenger: string;
  sequencer: string;
  challengerClaim: string;
  sequencerClaim: string;
  challengerBond: bigint;
  sequencerBond: bigint;
  createdAt: bigint;
  deadline: bigint;
  bisectionCommitment: string;
  status: DisputeStatus;
  resolvedAt: bigint;    // Phase 7: resolution timestamp
  l1Head: string;        // Phase 7: L1 block hash at creation
}

// ============================================
// RollupManager Client
// ============================================
export class RollupManagerClient {
  private contract: Contract;

  constructor(address: string, signerOrProvider: Wallet | Provider) {
    this.contract = new Contract(address, ROLLUP_MANAGER_ABI, signerOrProvider);
  }

  async proposeStateRoot(stateRoot: string, batchIndex: bigint): Promise<string> {
    const tx = await this.contract.proposeStateRoot(stateRoot, batchIndex);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async getBatch(batchIndex: bigint): Promise<BatchInfo> {
    const batch = await this.contract.getBatch(batchIndex);
    return {
      stateRoot: batch.stateRoot,
      prevStateRoot: batch.prevStateRoot,
      timestamp: batch.timestamp,
      proposer: batch.proposer,
      status: batch.status as BatchStatus,
    };
  }

  async latestBatchIndex(): Promise<bigint> {
    return await this.contract.latestBatchIndex();
  }

  async latestFinalizedBatchIndex(): Promise<bigint> {
    return await this.contract.latestFinalizedBatchIndex();
  }

  async finalizeBatch(batchIndex: bigint): Promise<string> {
    const tx = await this.contract.finalizeBatch(batchIndex);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async getChallengePeriod(): Promise<bigint> {
    return await this.contract.CHALLENGE_PERIOD();
  }

  // Event listeners
  onStateRootProposed(
    callback: (batchIndex: bigint, stateRoot: string, prevStateRoot: string, proposer: string) => void
  ): void {
    this.contract.on('StateRootProposed', callback);
  }

  onBatchFinalized(callback: (batchIndex: bigint, stateHash: string) => void): void {
    this.contract.on('BatchFinalized', callback);
  }

  onBatchRejected(callback: (batchIndex: bigint, stateHash: string) => void): void {
    this.contract.on('BatchRejected', callback);
  }

  removeAllListeners(): void {
    this.contract.removeAllListeners();
  }
}

// ============================================
// DisputeManager Client
// ============================================
export class DisputeManagerClient {
  private contract: Contract;

  constructor(address: string, signerOrProvider: Wallet | Provider) {
    this.contract = new Contract(address, DISPUTE_MANAGER_ABI, signerOrProvider);
  }

  async initiateDispute(batchIndex: bigint, claimedStateRoot: string, bond: bigint): Promise<bigint> {
    const tx = await this.contract.initiateDispute(batchIndex, claimedStateRoot, { value: bond });
    const receipt = await tx.wait();

    // Extract disputeId from event
    const event = receipt.logs.find(
      (log: ethers.EventLog | ethers.Log) => 'fragment' in log && log.fragment?.name === 'DisputeInitiated'
    );
    if (event) {
      return event.args[0];
    }
    throw new Error('DisputeInitiated event not found');
  }

  async depositSequencerBond(disputeId: bigint, bond: bigint): Promise<string> {
    const tx = await this.contract.depositSequencerBond(disputeId, { value: bond });
    const receipt = await tx.wait();
    return receipt.hash;
  }

  /**
   * Submit the agreed bisection result on-chain.
   *
   * `bisectionCommitment` MUST be computed via `hashBisectionCommitment`
   * from `common/hash.ts` — it must equal
   * `keccak256(abi.encodePacked(poseidon(preState), poseidon(postState), disputedStep))`
   * to match `DisputeManager.sol:252-254`. Passing a keccak-of-state
   * commitment will cause `submitProof` to revert later.
   */
  async submitBisectionResult(
    disputeId: bigint,
    bisectionCommitment: string,
    disputedStep: bigint,
    challengerSig: string,
    sequencerSig: string
  ): Promise<string> {
    const tx = await this.contract.submitBisectionResult(
      disputeId,
      bisectionCommitment,
      disputedStep,
      challengerSig,
      sequencerSig
    );
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async submitProof(disputeId: bigint, zkProof: ZKProof): Promise<string> {
    // Convert proof format to contract format
    const proof = [
      BigInt(zkProof.proof.a[0]),
      BigInt(zkProof.proof.a[1]),
      BigInt(zkProof.proof.b[0][0]),
      BigInt(zkProof.proof.b[0][1]),
      BigInt(zkProof.proof.b[1][0]),
      BigInt(zkProof.proof.b[1][1]),
      BigInt(zkProof.proof.c[0]),
      BigInt(zkProof.proof.c[1]),
    ];

    const publicInputs = zkProof.publicInputs.map((x) => BigInt(x));

    const tx = await this.contract.submitProof(disputeId, proof, publicInputs);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async resolveDispute(disputeId: bigint): Promise<string> {
    const tx = await this.contract.resolveDispute(disputeId);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async triggerTimeout(disputeId: bigint): Promise<string> {
    const tx = await this.contract.triggerTimeout(disputeId);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async getDispute(disputeId: bigint): Promise<DisputeInfo> {
    const dispute = await this.contract.getDispute(disputeId);
    return {
      batchIndex: dispute.batchIndex,
      challenger: dispute.challenger,
      sequencer: dispute.sequencer,
      challengerClaim: dispute.challengerClaim,
      sequencerClaim: dispute.sequencerClaim,
      challengerBond: dispute.challengerBond,
      sequencerBond: dispute.sequencerBond,
      createdAt: dispute.createdAt,
      deadline: dispute.deadline,
      bisectionCommitment: dispute.bisectionCommitment,
      status: dispute.status as DisputeStatus,
      resolvedAt: dispute.resolvedAt,
      l1Head: dispute.l1Head,
    };
  }

  async getRequiredBond(): Promise<bigint> {
    return await this.contract.requiredBond();
  }

  async getActiveDispute(batchIndex: bigint): Promise<bigint> {
    return await this.contract.activeDisputes(batchIndex);
  }

  async getBisectionDeadline(): Promise<bigint> {
    return await this.contract.BISECTION_DEADLINE();
  }

  async getProofDeadline(): Promise<bigint> {
    return await this.contract.PROOF_DEADLINE();
  }

  // Event listeners
  onDisputeInitiated(
    callback: (disputeId: bigint, batchIndex: bigint, challenger: string, challengerClaim: string) => void
  ): void {
    this.contract.on('DisputeInitiated', callback);
  }

  onBisectionCompleted(
    callback: (disputeId: bigint, bisectionCommitment: string, disputedStep: bigint) => void
  ): void {
    this.contract.on('BisectionCompleted', callback);
  }

  onProofSubmitted(
    callback: (disputeId: bigint, submitter: string, proofValid: boolean) => void
  ): void {
    this.contract.on('ProofSubmitted', callback);
  }

  onDisputeResolved(
    callback: (disputeId: bigint, winner: string, reward: bigint) => void
  ): void {
    this.contract.on('DisputeResolved', callback);
  }

  onDisputeTimeout(callback: (disputeId: bigint) => void): void {
    this.contract.on('DisputeTimeout', callback);
  }

  removeAllListeners(): void {
    this.contract.removeAllListeners();
  }
}

// ============================================
// ZKVerifier Client
// ============================================
export class ZKVerifierClient {
  private contract: Contract;

  constructor(address: string, provider: Provider) {
    this.contract = new Contract(address, ZK_VERIFIER_ABI, provider);
  }

  async verifyProof(zkProof: ZKProof): Promise<boolean> {
    const a: [bigint, bigint] = [BigInt(zkProof.proof.a[0]), BigInt(zkProof.proof.a[1])];
    const b: [[bigint, bigint], [bigint, bigint]] = [
      [BigInt(zkProof.proof.b[0][0]), BigInt(zkProof.proof.b[0][1])],
      [BigInt(zkProof.proof.b[1][0]), BigInt(zkProof.proof.b[1][1])],
    ];
    const c: [bigint, bigint] = [BigInt(zkProof.proof.c[0]), BigInt(zkProof.proof.c[1])];
    const publicInputs = zkProof.publicInputs.map((x) => BigInt(x));

    return await this.contract.verifyProof(a, b, c, publicInputs);
  }
}

// ============================================
// DisputeGameFactory Client (Phase 7)
// ============================================
export class DisputeGameFactoryClient {
  private contract: Contract;

  constructor(address: string, signerOrProvider: Wallet | Provider) {
    this.contract = new Contract(address, DISPUTE_GAME_FACTORY_ABI, signerOrProvider);
  }

  async setImplementation(gt: GameType, implementation: string): Promise<string> {
    const tx = await this.contract.setImplementation(gt, implementation);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async create(
    gt: GameType,
    rootClaim: Claim,
    l2BlockNumber: bigint,
    extraData: string,
    value?: bigint
  ): Promise<string> {
    const tx = await this.contract.create(gt, rootClaim, l2BlockNumber, extraData, {
      value: value ?? 0n,
    });
    const receipt = await tx.wait();

    // Return the proxy address from the event
    const event = receipt.logs.find(
      (log: ethers.EventLog | ethers.Log) => 'fragment' in log && log.fragment?.name === 'DisputeGameCreated'
    );
    if (event) {
      return event.args[0]; // proxy address
    }
    throw new Error('DisputeGameCreated event not found');
  }

  async games(gt: GameType, rootClaim: Claim, extraData: string): Promise<string> {
    return await this.contract.games(gt, rootClaim, extraData);
  }

  async gameCount(): Promise<bigint> {
    return await this.contract.gameCount();
  }

  async gameAtIdx(index: bigint): Promise<string> {
    return await this.contract.gameAtIdx(index);
  }

  async getImplementation(gt: GameType): Promise<string> {
    return await this.contract.implementations(gt);
  }

  // Event listeners
  onDisputeGameCreated(
    callback: (event: DisputeGameCreatedEvent) => void
  ): void {
    this.contract.on('DisputeGameCreated', (proxy, gt, rootClaim, l2BlockNumber, extraData) => {
      callback({
        proxy,
        gameType: gt as GameType,
        rootClaim: rootClaim as Claim,
        l2BlockNumber,
        extraData,
      });
    });
  }

  onImplementationSet(
    callback: (gameType: GameType, implementation: string) => void
  ): void {
    this.contract.on('ImplementationSet', callback);
  }

  removeAllListeners(): void {
    this.contract.removeAllListeners();
  }
}
