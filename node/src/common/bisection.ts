/**
 * Off-chain bisection protocol
 * Implementation of Cannon FPVM's 73-step bisection logic off-chain
 */

import { ethers } from 'ethers';
import {
  MipsState,
  StateCommitment,
  BisectionMove,
  ChannelState,
  DEFAULT_CONFIG,
} from './types';
import { hashBisectionCommitment } from './hash';

/**
 * Bisection protocol executor
 */
export class BisectionProtocol {
  private readonly maxDepth: number;
  private readonly timeout: number;

  constructor(maxDepth = DEFAULT_CONFIG.maxDepth, timeout = DEFAULT_CONFIG.bisectionTimeout) {
    this.maxDepth = maxDepth;
    this.timeout = timeout;
  }

  /**
   * Calculate bisection dispute range
   * Dispute range at depth d is 2^(73-d) steps
   */
  calculateDisputeRange(depth: number, startStep: bigint, endStep: bigint): {
    midpoint: bigint;
    leftStart: bigint;
    leftEnd: bigint;
    rightStart: bigint;
    rightEnd: bigint;
  } {
    const range = endStep - startStep;
    const midpoint = startStep + range / 2n;

    return {
      midpoint,
      leftStart: startStep,
      leftEnd: midpoint,
      rightStart: midpoint,
      rightEnd: endStep,
    };
  }

  /**
   * Calculate state hash (Poseidon hash)
   * Must use the same hash function as the ZK circuit
   */
  calculateStateHash(state: MipsState): string {
    // Simplified version: using keccak256
    // In production, Poseidon hash should be used
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'uint256[32]', 'uint256', 'uint256', 'bytes32'],
      [
        state.pc,
        state.registers,
        state.hi,
        state.lo,
        state.memoryRoot,
      ]
    );
    return ethers.keccak256(encoded);
  }

  /**
   * Create bisection commitment
   */
  createCommitment(state: MipsState, step: bigint): StateCommitment {
    return {
      stateHash: this.calculateStateHash(state),
      step,
    };
  }

  /**
   * Create attack move (challenger)
   * Attack the midpoint of the dispute range
   */
  createAttackMove(
    disputeId: string,
    depth: number,
    position: bigint,
    claim: StateCommitment,
    signer: ethers.Wallet | ethers.HDNodeWallet
  ): BisectionMove {
    const message = ethers.solidityPackedKeccak256(
      ['string', 'string', 'uint256', 'uint256', 'bytes32'],
      ['attack', disputeId, depth, position, claim.stateHash]
    );

    return {
      type: 'attack',
      disputeId,
      depth,
      position,
      claim,
      signature: signer.signMessageSync(ethers.getBytes(message)),
      timestamp: Date.now(),
    };
  }

  /**
   * Create defend move (sequencer)
   * Present the correct state at the attack point
   */
  createDefendMove(
    disputeId: string,
    depth: number,
    position: bigint,
    claim: StateCommitment,
    signer: ethers.Wallet | ethers.HDNodeWallet
  ): BisectionMove {
    const message = ethers.solidityPackedKeccak256(
      ['string', 'string', 'uint256', 'uint256', 'bytes32'],
      ['defend', disputeId, depth, position, claim.stateHash]
    );

    return {
      type: 'defend',
      disputeId,
      depth,
      position,
      claim,
      signature: signer.signMessageSync(ethers.getBytes(message)),
      timestamp: Date.now(),
    };
  }

  /**
   * Verify move signature
   */
  verifyMoveSignature(move: BisectionMove, expectedSigner: string): boolean {
    const message = ethers.solidityPackedKeccak256(
      ['string', 'string', 'uint256', 'uint256', 'bytes32'],
      [move.type, move.disputeId, move.depth, move.position, move.claim.stateHash]
    );

    const recoveredAddress = ethers.verifyMessage(
      ethers.getBytes(message),
      move.signature
    );

    return recoveredAddress.toLowerCase() === expectedSigner.toLowerCase();
  }

  /**
   * Execute off-chain bisection
   * Perform 73 rounds of bisection between sequencer and challenger
   */
  async executeBisection(
    channel: ChannelState,
    getStateAtStep: (step: bigint) => Promise<MipsState>,
    sequencerSigner: ethers.Wallet,
    challengerSigner: ethers.Wallet,
    onMove?: (move: BisectionMove) => void
  ): Promise<{
    disputedStep: bigint;
    preState: MipsState;
    postState: MipsState;
    moves: BisectionMove[];
  }> {
    const moves: BisectionMove[] = [];
    let currentStart = channel.startStep;
    let currentEnd = channel.endStep;

    for (let depth = 0; depth < this.maxDepth; depth++) {
      const { midpoint } = this.calculateDisputeRange(depth, currentStart, currentEnd);

      // Challenger: attack the midpoint
      const challengerState = await getStateAtStep(midpoint);
      const challengerClaim = this.createCommitment(challengerState, midpoint);
      const attackMove = this.createAttackMove(
        channel.channelId,
        depth,
        midpoint,
        challengerClaim,
        challengerSigner
      );
      moves.push(attackMove);
      onMove?.(attackMove);

      // Sequencer: defend the state at the same point
      const sequencerState = await getStateAtStep(midpoint);
      const sequencerClaim = this.createCommitment(sequencerState, midpoint);
      const defendMove = this.createDefendMove(
        channel.channelId,
        depth,
        midpoint,
        sequencerClaim,
        sequencerSigner
      );
      moves.push(defendMove);
      onMove?.(defendMove);

      // Check for disagreement and narrow the dispute range
      if (challengerClaim.stateHash !== sequencerClaim.stateHash) {
        // Disagreement: narrow to the left half
        currentEnd = midpoint;
      } else {
        // Agreement: narrow to the right half
        currentStart = midpoint;
      }

      // Terminate when reaching a single step
      if (currentEnd - currentStart <= 1n) {
        break;
      }
    }

    // Pre and post states of the disputed single step
    const disputedStep = currentStart;
    const preState = await getStateAtStep(disputedStep);
    const postState = await getStateAtStep(disputedStep + 1n);

    return {
      disputedStep,
      preState,
      postState,
      moves,
    };
  }

  /**
   * Create bisection result commitment.
   * Both parties sign and submit on-chain.
   *
   * Inner hashes (preStateHash, postStateHash) MUST be Poseidon outputs
   * to match DisputeManager.sol:252-254 — keccak-of-state inputs will
   * make submitProof revert with "proof does not match bisection".
   * Delegates to hashBisectionCommitment so the formula lives in one place.
   */
  createBisectionCommitment(
    _disputeId: string,
    disputedStep: bigint,
    preStateHash: string,
    postStateHash: string
  ): string {
    return hashBisectionCommitment(preStateHash, postStateHash, disputedStep);
  }

  /**
   * Check timeout
   */
  checkTimeout(lastActivityAt: number): boolean {
    return Date.now() - lastActivityAt > this.timeout * 1000;
  }
}

/**
 * Channel state manager
 */
export class ChannelManager {
  private channels: Map<string, ChannelState> = new Map();

  /**
   * Create new channel
   */
  createChannel(
    disputeId: string,
    sequencer: string,
    challenger: string,
    startStep: bigint,
    endStep: bigint
  ): ChannelState {
    const channel: ChannelState = {
      channelId: disputeId,
      sequencer,
      challenger,
      currentDepth: 0,
      maxDepth: DEFAULT_CONFIG.maxDepth,
      startStep,
      endStep,
      moves: [],
      status: 'open',
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    this.channels.set(disputeId, channel);
    return channel;
  }

  /**
   * Get channel
   */
  getChannel(disputeId: string): ChannelState | undefined {
    return this.channels.get(disputeId);
  }

  /**
   * Update channel
   */
  updateChannel(disputeId: string, update: Partial<ChannelState>): void {
    const channel = this.channels.get(disputeId);
    if (channel) {
      const updated = { ...channel, ...update, lastActivityAt: Date.now() };
      this.channels.set(disputeId, updated);
    }
  }

  /**
   * Add move
   */
  addMove(disputeId: string, move: BisectionMove): void {
    const channel = this.channels.get(disputeId);
    if (channel) {
      const updated = {
        ...channel,
        moves: [...channel.moves, move],
        currentDepth: move.depth + 1,
        lastActivityAt: Date.now(),
      };
      this.channels.set(disputeId, updated);
    }
  }

  /**
   * Close channel
   */
  closeChannel(disputeId: string): void {
    const channel = this.channels.get(disputeId);
    if (channel) {
      const updated = { ...channel, status: 'closed' as const };
      this.channels.set(disputeId, updated);
    }
  }
}
