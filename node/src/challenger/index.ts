/**
 * SI-RVP - Challenger Node
 *
 * Challenger node: state monitoring, dispute initiation, bisection attack
 */

import { ethers, Wallet, Provider } from 'ethers';
import * as dotenv from 'dotenv';
import {
  MipsState,
  StateCommitment,
  BisectionMove,
  ChannelState,
  ZKProof,
  DEFAULT_CONFIG,
} from '../common/types';
import {
  RollupManagerClient,
  DisputeManagerClient,
  DisputeGameFactoryClient,
  BatchStatus,
  DisputeInfo,
  DisputeStatus,
} from '../common/contracts';
import {
  P2PNode,
  P2PMessageHandler,
  ChannelOpenPayload,
  ChannelAckPayload,
  BisectionMovePayload,
  ProofSubmitPayload,
} from '../common/p2p';
import { BisectionProtocol, ChannelManager } from '../common/bisection';
import { ZKProver, PoseidonHasher } from '../common/prover';
import { MipsExecutor } from '../common/mips';
import { logger } from '../common/logger';
import { ProgramExecutor } from '../common/executor';
import { installGracefulShutdown } from '../common/shutdown';

dotenv.config();

// ============================================
// Configuration
// ============================================
interface ChallengerConfig {
  privateKey: string;
  rpcUrl: string;
  rollupManagerAddress: string;
  disputeManagerAddress: string;
  sequencerP2PUrl: string;
  sequencerAddress: string;
  /** Phase 7: Optional factory address for DisputeGameCreated event listening */
  factoryAddress?: string;
}

// ============================================
// Challenger Node
// ============================================
export class ChallengerNode implements P2PMessageHandler {
  private config: ChallengerConfig;
  private wallet: Wallet;
  private provider: Provider;
  private rollupManager: RollupManagerClient;
  private disputeManager: DisputeManagerClient;
  private p2pNode: P2PNode;
  private bisectionProtocol: BisectionProtocol;
  private channelManager: ChannelManager;
  private poseidonHasher: PoseidonHasher;
  private programExecutor: ProgramExecutor;
  private factory: DisputeGameFactoryClient | null = null;

  // State storage (challenger's view)
  private stateHistory: Map<bigint, MipsState> = new Map();
  private instructionHistory: Map<bigint, bigint> = new Map();
  private pendingDisputes: Map<bigint, { disputeId: bigint; batchIndex: bigint }> = new Map();
  private currentDispute: {
    disputeId: bigint;
    channel: ChannelState;
    disputedStep?: bigint;
  } | null = null;

  constructor(config: ChallengerConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new Wallet(config.privateKey, this.provider);

    this.rollupManager = new RollupManagerClient(config.rollupManagerAddress, this.wallet);
    this.disputeManager = new DisputeManagerClient(config.disputeManagerAddress, this.wallet);

    this.p2pNode = new P2PNode(this.wallet, this);
    this.bisectionProtocol = new BisectionProtocol();
    this.channelManager = new ChannelManager();
    this.poseidonHasher = new PoseidonHasher();
    const mipsExecutor = new MipsExecutor();
    this.programExecutor = new ProgramExecutor(mipsExecutor, this.poseidonHasher);

    // Phase 7: Optional factory event listener
    if (config.factoryAddress) {
      this.factory = new DisputeGameFactoryClient(config.factoryAddress, this.wallet);
    }
  }

  /**
   * Initialize node
   */
  async initialize(): Promise<void> {
    logger.info('Challenger', 'Initializing...');
    logger.info('Challenger', `Address: ${this.wallet.address}`);

    // Initialize Poseidon hasher
    await this.poseidonHasher.initialize();

    // Setup event listeners
    this.setupEventListeners();

    logger.info('Challenger', 'Initialized successfully');
  }

  /**
   * Setup blockchain event listeners
   */
  private setupEventListeners(): void {
    // Listen for new state root proposals
    this.rollupManager.onStateRootProposed(async (batchIndex, stateRoot, prevStateRoot, proposer) => {
      try {
        logger.info('Challenger', `New state root proposed for batch ${batchIndex}: ${stateRoot}`);
        await this.verifyStateRoot(batchIndex, stateRoot);
      } catch (err) {
        logger.error('Challenger', `Error handling state root proposal: ${(err as Error).message}`);
      }
    });

    // Listen for dispute resolutions
    this.disputeManager.onDisputeResolved(async (disputeId, winner, reward) => {
      try {
        const isWinner = winner.toLowerCase() === this.wallet.address.toLowerCase();
        logger.info('Challenger', `Dispute ${disputeId} resolved. Winner: ${isWinner ? 'Challenger (me)' : 'Sequencer'}`);
        if (isWinner) {
          logger.info('Challenger', `Reward received: ${ethers.formatEther(reward)} ETH`);
        }
        this.currentDispute = null;
      } catch (err) {
        logger.error('Challenger', `Error handling dispute resolution: ${(err as Error).message}`);
      }
    });

    // Phase 7: Listen for factory-created dispute games
    if (this.factory) {
      this.factory.onDisputeGameCreated(async (event) => {
        try {
          logger.info('Challenger', `DisputeGame created via factory: proxy=${event.proxy}, gameType=${event.gameType}, rootClaim=${event.rootClaim}`);
        } catch (err) {
          logger.error('Challenger', `Error handling dispute game creation: ${(err as Error).message}`);
        }
      });
    }
  }

  /**
   * Connect to sequencer P2P
   */
  async connectToSequencer(): Promise<void> {
    logger.info('Challenger', `Connecting to sequencer at ${this.config.sequencerP2PUrl}`);
    await this.p2pNode.connect(this.config.sequencerP2PUrl, this.config.sequencerAddress);
    logger.info('Challenger', 'Connected to sequencer');
  }

  /**
   * Execute MIPS program locally for verification
   */
  async executeProgram(
    instructions: bigint[],
    initialState?: MipsState
  ): Promise<{ finalState: MipsState; stateRoot: string }> {
    const result = await this.programExecutor.execute(instructions, initialState);
    for (const [k, v] of result.stateHistory) this.stateHistory.set(k, v);
    for (const [k, v] of result.instructionHistory) this.instructionHistory.set(k, v);
    return { finalState: result.finalState, stateRoot: result.stateRoot };
  }

  /**
   * Verify proposed state root against local execution
   */
  async verifyStateRoot(batchIndex: bigint, proposedStateRoot: string): Promise<boolean> {
    // Get local state root for comparison
    if (this.stateHistory.size === 0) {
      logger.info('Challenger', 'No local state to compare (empty history)');
      return true;
    }
    let latestStep = -1n;
    for (const k of this.stateHistory.keys()) {
      if (k > latestStep) latestStep = k;
    }
    const localState = this.stateHistory.get(latestStep);

    if (!localState) {
      logger.info('Challenger', 'No local state to compare');
      return true;
    }

    const localStateHash = this.poseidonHasher.hashMipsState(localState);
    const localStateRoot = '0x' + localStateHash.toString(16).padStart(64, '0');

    if (localStateRoot !== proposedStateRoot) {
      logger.info('Challenger', 'State root mismatch!');
      logger.info('Challenger', `  Proposed: ${proposedStateRoot}`);
      logger.info('Challenger', `  Local:    ${localStateRoot}`);
      return false;
    }

    logger.info('Challenger', `State root verified for batch ${batchIndex}`);
    return true;
  }

  /**
   * Initiate dispute for invalid state root
   */
  async initiateDispute(batchIndex: bigint, correctStateRoot: string): Promise<bigint> {
    logger.info('Challenger', `Initiating dispute for batch ${batchIndex}`);

    // Get required bond
    const bondAmount = await this.disputeManager.getRequiredBond();
    logger.info('Challenger', `Required bond: ${ethers.formatEther(bondAmount)} ETH`);

    // Initiate dispute on-chain
    const disputeId = await this.disputeManager.initiateDispute(batchIndex, correctStateRoot, bondAmount);
    logger.info('Challenger', `Dispute created with ID: ${disputeId}`);

    this.pendingDisputes.set(batchIndex, { disputeId, batchIndex });

    return disputeId;
  }

  /**
   * Start bisection process with sequencer
   */
  async startBisection(disputeId: bigint, startStep: bigint, endStep: bigint): Promise<void> {
    // Connect to sequencer if not connected
    if (!this.p2pNode.isConnected(this.config.sequencerAddress)) {
      await this.connectToSequencer();
    }

    // Get dispute info
    const dispute = await this.disputeManager.getDispute(disputeId);

    // Create channel
    const channel = this.channelManager.createChannel(
      disputeId.toString(),
      dispute.sequencer,
      this.wallet.address,
      startStep,
      endStep
    );

    this.currentDispute = { disputeId, channel };

    // Send channel open request
    const payload: ChannelOpenPayload = {
      disputeId: disputeId.toString(),
      batchIndex: dispute.batchIndex,
      sequencer: dispute.sequencer,
      challenger: this.wallet.address,
      sequencerClaim: dispute.sequencerClaim,
      challengerClaim: dispute.challengerClaim,
      startStep,
      endStep,
    };

    await this.p2pNode.send(this.config.sequencerAddress, 'channel_open', payload);
    logger.info('Challenger', 'Channel open request sent');
  }

  // ============================================
  // P2P Message Handlers
  // ============================================

  /**
   * Handle channel acknowledgment from sequencer
   */
  async onChannelAck(payload: ChannelAckPayload, from: string): Promise<void> {
    logger.info('Challenger', `Channel ack received: ${payload.accepted ? 'accepted' : 'rejected'}`);

    if (!payload.accepted) {
      logger.error('Challenger', 'Channel rejected by sequencer');
      return;
    }

    // Start bisection with first attack
    if (this.currentDispute) {
      await this.sendFirstAttack();
    }
  }

  /**
   * Handle bisection move from sequencer (defend)
   */
  async onBisectionMove(payload: BisectionMovePayload, from: string): Promise<void> {
    const move = payload.move;
    logger.info('Challenger', `Received ${move.type} at depth ${move.depth}`);

    if (!this.currentDispute) {
      logger.error('Challenger', 'No active dispute');
      return;
    }

    const channel = this.currentDispute.channel;

    // Verify signature
    if (!this.bisectionProtocol.verifyMoveSignature(move, channel.sequencer)) {
      logger.error('Challenger', 'Invalid move signature');
      return;
    }

    // Record move, then re-read: ChannelManager replaces the stored channel
    // with a new object on every mutation, so the cached reference above does
    // not contain this move.
    this.channelManager.addMove(move.disputeId, move);
    const channelWithMove = this.refreshCurrentChannel();

    // Check if we've found the disputed step
    const lastAttack = channelWithMove.moves
      ?.filter((m: BisectionMove) => m.type === 'attack')
      .pop();
    if (lastAttack && lastAttack.claim.stateHash !== move.claim.stateHash) {
      // Found disagreement - this is our disputed step
      this.currentDispute.disputedStep = move.position;
      logger.info('Challenger', `Found disputed step: ${move.position}`);
      await this.requestProof();
      return;
    }

    // Check if max depth reached
    if (move.depth >= channelWithMove.maxDepth - 1) {
      logger.info('Challenger', 'Max depth reached, requesting proof');
      this.currentDispute.disputedStep = move.position;
      await this.requestProof();
      return;
    }

    // Send next attack
    await this.sendAttack(move.depth + 1, move.position);
  }

  /**
   * Handle proof submission from sequencer
   */
  async onProofSubmit(payload: ProofSubmitPayload, from: string): Promise<void> {
    logger.info('Challenger', 'Received ZK proof from sequencer');

    if (!this.currentDispute) {
      logger.error('Challenger', 'No active dispute');
      return;
    }

    // Format proof
    const zkProof: ZKProof = {
      proof: payload.proof,
      publicInputs: payload.publicInputs,
    };

    // Submit proof on-chain
    logger.info('Challenger', 'Submitting proof on-chain...');
    await this.submitProofOnchain(BigInt(payload.disputeId), zkProof);
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Send first attack to start bisection
   */
  private async sendFirstAttack(): Promise<void> {
    if (!this.currentDispute) return;

    const channel = this.currentDispute.channel;
    const { midpoint } = this.bisectionProtocol.calculateDisputeRange(0, channel.startStep, channel.endStep);

    await this.sendAttack(0, midpoint);
  }

  /**
   * Re-read the current dispute's channel from the manager and replace the
   * cached copy. ChannelManager returns a new object on every mutation, so a
   * cached reference goes stale as soon as a move is recorded.
   */
  private refreshCurrentChannel(): ChannelState {
    if (!this.currentDispute) {
      throw new Error('Challenger: refreshCurrentChannel called with no active dispute');
    }

    const channelId = this.currentDispute.channel.channelId;
    const channel = this.channelManager.getChannel(channelId);
    if (!channel) {
      throw new Error(`Challenger: channel ${channelId} not found`);
    }

    this.currentDispute = { ...this.currentDispute, channel };
    return channel;
  }

  /**
   * Send attack move
   */
  private async sendAttack(depth: number, position: bigint): Promise<void> {
    if (!this.currentDispute) return;

    const channel = this.currentDispute.channel;
    const state = await this.getStateAtStep(position);

    if (!state) {
      logger.error('Challenger', `State not found for step ${position}`);
      return;
    }

    const claim = this.bisectionProtocol.createCommitment(state, position);
    const attackMove = this.bisectionProtocol.createAttackMove(
      channel.channelId,
      depth,
      position,
      claim,
      this.wallet
    );

    this.channelManager.addMove(channel.channelId, attackMove);
    this.refreshCurrentChannel();

    await this.p2pNode.send(channel.sequencer, 'bisection_move', { move: attackMove });
    logger.info('Challenger', `Attack sent at depth ${depth}, position ${position}`);
  }

  /**
   * Request ZK proof from sequencer
   */
  private async requestProof(): Promise<void> {
    if (!this.currentDispute || !this.currentDispute.disputedStep) return;

    const channel = this.currentDispute.channel;
    const disputedStep = this.currentDispute.disputedStep;

    const preState = await this.getStateAtStep(disputedStep);
    const postState = await this.getStateAtStep(disputedStep + 1n);

    if (!preState || !postState) {
      logger.error('Challenger', 'Missing state for proof request');
      return;
    }

    const preStateHash = this.poseidonHasher.hashMipsState(preState);
    const postStateHash = this.poseidonHasher.hashMipsState(postState);

    await this.p2pNode.send(channel.sequencer, 'proof_request', {
      disputeId: channel.channelId,
      disputedStep,
      preStateHash: '0x' + preStateHash.toString(16).padStart(64, '0'),
      postStateHash: '0x' + postStateHash.toString(16).padStart(64, '0'),
    });

    logger.info('Challenger', 'Proof request sent');
  }

  /**
   * Get state at specific step
   */
  private async getStateAtStep(step: bigint): Promise<MipsState | undefined> {
    return this.stateHistory.get(step);
  }

  /**
   * Submit ZK proof to on-chain contract
   */
  async submitProofOnchain(disputeId: bigint, zkProof: ZKProof): Promise<string> {
    logger.info('Challenger', `Submitting proof on-chain for dispute ${disputeId}`);
    const txHash = await this.disputeManager.submitProof(disputeId, zkProof);
    logger.info('Challenger', `Proof submitted: ${txHash}`);

    // Resolve dispute
    logger.info('Challenger', 'Resolving dispute...');
    await this.disputeManager.resolveDispute(disputeId);

    return txHash;
  }

  /**
   * Trigger timeout if sequencer doesn't respond
   */
  async triggerTimeout(disputeId: bigint): Promise<void> {
    logger.info('Challenger', `Triggering timeout for dispute ${disputeId}`);
    await this.disputeManager.triggerTimeout(disputeId);
  }

  /**
   * Shutdown node
   */
  async shutdown(): Promise<void> {
    logger.info('Challenger', 'Shutting down...');
    this.rollupManager.removeAllListeners();
    this.disputeManager.removeAllListeners();
    await this.p2pNode.close();
    logger.info('Challenger', 'Shutdown complete');
  }
}

// ============================================
// Main Entry Point
// ============================================
async function main() {
  const config: ChallengerConfig = {
    privateKey: process.env.CHALLENGER_PRIVATE_KEY || '',
    rpcUrl: process.env.RPC_URL || 'http://127.0.0.1:8545',
    rollupManagerAddress: process.env.ROLLUP_MANAGER_ADDRESS || '',
    disputeManagerAddress: process.env.DISPUTE_MANAGER_ADDRESS || '',
    sequencerP2PUrl: process.env.SEQUENCER_P2P_URL || 'ws://localhost:9000',
    sequencerAddress: process.env.SEQUENCER_ADDRESS || '',
  };

  if (!config.privateKey) {
    logger.error('Challenger', 'CHALLENGER_PRIVATE_KEY not set');
    process.exit(1);
  }

  const challenger = new ChallengerNode(config);
  await challenger.initialize();

  // Handle shutdown
  installGracefulShutdown('Challenger', () => challenger.shutdown());

  process.on('unhandledRejection', (reason) => {
    logger.error('Challenger', `Unhandled rejection: ${reason}`);
  });

  logger.info('Challenger', 'Running...');
}

// Run if main module
if (require.main === module) {
  main().catch((err) => {
    logger.error('Challenger', `Fatal error: ${err.message || err}`);
    process.exit(1);
  });
}

export default ChallengerNode;
