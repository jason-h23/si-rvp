/**
 * SI-RVP - Sequencer Node
 *
 * Sequencer node: state root submission, dispute response, ZK proof generation
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
  DisputeInfo,
  DisputeStatus,
} from '../common/contracts';
import {
  P2PNode,
  P2PMessageHandler,
  ChannelOpenPayload,
  BisectionMovePayload,
  ProofRequestPayload,
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
interface SequencerConfig {
  privateKey: string;
  rpcUrl: string;
  rollupManagerAddress: string;
  disputeManagerAddress: string;
  p2pPort: number;
  /** Phase 7: Optional factory address for DisputeGameCreated event listening */
  factoryAddress?: string;
}

// ============================================
// Sequencer Node
// ============================================
export class SequencerNode implements P2PMessageHandler {
  private config: SequencerConfig;
  private wallet: Wallet;
  private provider: Provider;
  private rollupManager: RollupManagerClient;
  private disputeManager: DisputeManagerClient;
  private p2pNode: P2PNode;
  private bisectionProtocol: BisectionProtocol;
  private channelManager: ChannelManager;
  private zkProver: ZKProver;
  private poseidonHasher: PoseidonHasher;
  private programExecutor: ProgramExecutor;
  private factory: DisputeGameFactoryClient | null = null;

  // State storage (in-memory for POC)
  private stateHistory: Map<bigint, MipsState> = new Map();
  private instructionHistory: Map<bigint, bigint> = new Map();
  private activeDisputes: Map<bigint, DisputeInfo> = new Map();

  constructor(config: SequencerConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new Wallet(config.privateKey, this.provider);

    this.rollupManager = new RollupManagerClient(config.rollupManagerAddress, this.wallet);
    this.disputeManager = new DisputeManagerClient(config.disputeManagerAddress, this.wallet);

    this.p2pNode = new P2PNode(this.wallet, this);
    this.bisectionProtocol = new BisectionProtocol();
    this.channelManager = new ChannelManager();
    this.zkProver = new ZKProver();
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
    logger.info('Sequencer', 'Initializing...');
    logger.info('Sequencer', `Address: ${this.wallet.address}`);

    // Initialize ZK prover
    await this.zkProver.initialize();
    await this.poseidonHasher.initialize();

    // Setup event listeners
    this.setupEventListeners();

    // Start P2P server
    this.p2pNode.startServer(this.config.p2pPort);

    logger.info('Sequencer', 'Initialized successfully');
  }

  /**
   * Setup blockchain event listeners
   */
  private setupEventListeners(): void {
    // Listen for new disputes
    this.disputeManager.onDisputeInitiated(async (disputeId, batchIndex, challenger, challengerClaim) => {
      try {
        logger.info('Sequencer', `Dispute initiated: ${disputeId} for batch ${batchIndex}`);
        await this.handleDisputeInitiated(disputeId, batchIndex, challenger, challengerClaim);
      } catch (err) {
        logger.error('Sequencer', `Error handling dispute initiation: ${(err as Error).message}`);
      }
    });

    // Listen for proof submissions
    this.disputeManager.onProofSubmitted(async (disputeId, submitter, proofValid) => {
      try {
        logger.info('Sequencer', `Proof submitted for dispute ${disputeId}: ${proofValid ? 'valid' : 'invalid'}`);
      } catch (err) {
        logger.error('Sequencer', `Error handling proof submission: ${(err as Error).message}`);
      }
    });

    // Listen for dispute resolutions
    this.disputeManager.onDisputeResolved(async (disputeId, winner, reward) => {
      try {
        logger.info('Sequencer', `Dispute ${disputeId} resolved. Winner: ${winner}, Reward: ${ethers.formatEther(reward)} ETH`);
        this.activeDisputes.delete(disputeId);
      } catch (err) {
        logger.error('Sequencer', `Error handling dispute resolution: ${(err as Error).message}`);
      }
    });

    // Phase 7: Listen for factory-created dispute games
    if (this.factory) {
      this.factory.onDisputeGameCreated(async (event) => {
        try {
          logger.info('Sequencer', `DisputeGame created via factory: proxy=${event.proxy}, gameType=${event.gameType}`);
        } catch (err) {
          logger.error('Sequencer', `Error handling dispute game creation: ${(err as Error).message}`);
        }
      });
    }
  }

  /**
   * Submit new state root
   */
  async submitStateRoot(stateRoot: string, batchIndex: bigint): Promise<string> {
    logger.info('Sequencer', `Submitting state root for batch ${batchIndex}`);
    const txHash = await this.rollupManager.proposeStateRoot(stateRoot, batchIndex);
    logger.info('Sequencer', `State root submitted: ${txHash}`);
    return txHash;
  }

  /**
   * Execute MIPS program and store state history
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
   * Handle dispute initiation
   */
  private async handleDisputeInitiated(
    disputeId: bigint,
    batchIndex: bigint,
    challenger: string,
    challengerClaim: string
  ): Promise<void> {
    // Get dispute info
    const dispute = await this.disputeManager.getDispute(disputeId);
    this.activeDisputes.set(disputeId, dispute);

    // Deposit sequencer bond
    const bondAmount = await this.disputeManager.getRequiredBond();
    logger.info('Sequencer', `Depositing bond: ${ethers.formatEther(bondAmount)} ETH`);
    await this.disputeManager.depositSequencerBond(disputeId, bondAmount);

    logger.info('Sequencer', `Waiting for P2P connection from challenger: ${challenger}`);
  }

  // ============================================
  // P2P Message Handlers
  // ============================================

  /**
   * Handle channel open request from challenger
   */
  async onChannelOpen(payload: ChannelOpenPayload, from: string): Promise<void> {
    logger.info('Sequencer', `Channel open request from ${from}`);

    // Verify challenger is the one who initiated the dispute
    const dispute = this.activeDisputes.get(BigInt(payload.disputeId));
    if (!dispute || dispute.challenger.toLowerCase() !== from.toLowerCase()) {
      logger.error('Sequencer', 'Invalid channel open request');
      return;
    }

    // Create channel
    const channel = this.channelManager.createChannel(
      payload.disputeId,
      this.wallet.address,
      from,
      payload.startStep,
      payload.endStep
    );

    // Acknowledge channel
    await this.p2pNode.send(from, 'channel_ack', {
      disputeId: payload.disputeId,
      accepted: true,
    });

    logger.info('Sequencer', `Channel opened for dispute ${payload.disputeId}`);
  }

  /**
   * Handle bisection move from challenger (attack)
   */
  async onBisectionMove(payload: BisectionMovePayload, from: string): Promise<void> {
    const move = payload.move;
    logger.info('Sequencer', `Received ${move.type} at depth ${move.depth}`);

    const channel = this.channelManager.getChannel(move.disputeId);
    if (!channel) {
      logger.error('Sequencer', 'Channel not found');
      return;
    }

    // Verify signature
    if (!this.bisectionProtocol.verifyMoveSignature(move, channel.challenger)) {
      logger.error('Sequencer', 'Invalid move signature');
      return;
    }

    // Record move. ChannelManager replaces the stored channel with a new
    // object on every mutation, so the pre-addMove snapshot above does not
    // contain this move — re-read before inspecting the move history.
    this.channelManager.addMove(move.disputeId, move);
    const channelWithMove = this.channelManager.getChannel(move.disputeId);
    if (!channelWithMove) {
      throw new Error(`Sequencer: channel ${move.disputeId} disappeared after addMove`);
    }

    // Check if we've reached a single step
    if (
      move.depth >= channelWithMove.maxDepth - 1 ||
      this.isDisputeNarrowedToSingleStep(channelWithMove)
    ) {
      await this.handleBisectionComplete(channelWithMove, from);
      return;
    }

    // Generate defend move
    const state = await this.getStateAtStep(move.position);
    if (!state) {
      logger.error('Sequencer', 'State not found for step:', move.position);
      return;
    }

    const claim = this.bisectionProtocol.createCommitment(state, move.position);
    const defendMove = this.bisectionProtocol.createDefendMove(
      move.disputeId,
      move.depth,
      move.position,
      claim,
      this.wallet
    );

    this.channelManager.addMove(move.disputeId, defendMove);

    // Send defend move
    await this.p2pNode.send(from, 'bisection_move', { move: defendMove });
    logger.info('Sequencer', `Sent defend move at depth ${defendMove.depth}`);
  }

  /**
   * Handle proof request
   */
  async onProofRequest(payload: ProofRequestPayload, from: string): Promise<void> {
    logger.info('Sequencer', `Proof request for step ${payload.disputedStep}`);

    const preState = await this.getStateAtStep(payload.disputedStep);
    const postState = await this.getStateAtStep(payload.disputedStep + 1n);
    const instruction = this.instructionHistory.get(payload.disputedStep);

    if (!preState || !postState || instruction === undefined) {
      logger.error('Sequencer', 'Missing state or instruction data');
      return;
    }

    // Generate ZK proof
    const preStateHash = this.poseidonHasher.hashMipsState(preState);
    const postStateHash = this.poseidonHasher.hashMipsState(postState);

    const proofInput = ZKProver.createProofInput(
      preState,
      postState,
      preStateHash,
      postStateHash,
      instruction
    );

    logger.info('Sequencer', 'Generating ZK proof...');
    const zkProof = await this.zkProver.generateProof(proofInput);

    // Send proof
    await this.p2pNode.send(from, 'proof_submit', {
      disputeId: payload.disputeId,
      proof: zkProof.proof,
      publicInputs: zkProof.publicInputs,
    });

    logger.info('Sequencer', 'ZK proof sent to challenger');
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Get state at specific step
   */
  private async getStateAtStep(step: bigint): Promise<MipsState | undefined> {
    return this.stateHistory.get(step);
  }

  /**
   * Check if dispute has narrowed to single step
   */
  private isDisputeNarrowedToSingleStep(channel: ChannelState): boolean {
    if (channel.moves.length < 2) return false;

    const lastMoves = channel.moves.slice(-2);
    const [attack, defend] = lastMoves;

    // If claims differ at the same position, we've found the disputed step
    return attack.claim.stateHash !== defend.claim.stateHash;
  }

  /**
   * Handle bisection completion
   */
  private async handleBisectionComplete(channel: ChannelState, challenger: string): Promise<void> {
    logger.info('Sequencer', 'Bisection complete, preparing for ZK proof');

    const lastAttack = channel.moves.filter((m: BisectionMove) => m.type === 'attack').pop();
    if (!lastAttack) {
      logger.error('Sequencer', 'No attack moves found in channel');
      return;
    }
    const disputedStep = lastAttack.position;

    // Update channel status
    this.channelManager.updateChannel(channel.channelId, { status: 'awaiting_proof' });

    // Wait for proof request from challenger
    logger.info('Sequencer', `Disputed step: ${disputedStep}. Waiting for proof request...`);
  }

  /**
   * Submit ZK proof to on-chain contract
   */
  async submitProofOnchain(disputeId: bigint, zkProof: ZKProof): Promise<string> {
    logger.info('Sequencer', `Submitting proof on-chain for dispute ${disputeId}`);
    const txHash = await this.disputeManager.submitProof(disputeId, zkProof);
    logger.info('Sequencer', `Proof submitted: ${txHash}`);
    return txHash;
  }

  /**
   * Shutdown node
   */
  async shutdown(): Promise<void> {
    logger.info('Sequencer', 'Shutting down...');
    this.rollupManager.removeAllListeners();
    this.disputeManager.removeAllListeners();
    await this.p2pNode.close();
    logger.info('Sequencer', 'Shutdown complete');
  }
}

// ============================================
// Main Entry Point
// ============================================
async function main() {
  const config: SequencerConfig = {
    privateKey: process.env.SEQUENCER_PRIVATE_KEY || '',
    rpcUrl: process.env.RPC_URL || 'http://127.0.0.1:8545',
    rollupManagerAddress: process.env.ROLLUP_MANAGER_ADDRESS || '',
    disputeManagerAddress: process.env.DISPUTE_MANAGER_ADDRESS || '',
    p2pPort: parseInt(process.env.SEQUENCER_P2P_PORT || '9000'),
  };

  if (!config.privateKey) {
    logger.error('Sequencer', 'SEQUENCER_PRIVATE_KEY not set');
    process.exit(1);
  }

  const sequencer = new SequencerNode(config);
  await sequencer.initialize();

  // Handle shutdown
  installGracefulShutdown('Sequencer', () => sequencer.shutdown());

  process.on('unhandledRejection', (reason) => {
    logger.error('Sequencer', `Unhandled rejection: ${reason}`);
  });

  logger.info('Sequencer', 'Running...');
}

// Run if main module
if (require.main === module) {
  main().catch((err) => {
    logger.error('Sequencer', `Fatal error: ${err.message || err}`);
    process.exit(1);
  });
}

export default SequencerNode;
