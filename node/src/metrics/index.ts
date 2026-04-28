/**
 * SI-RVP - Metrics Collection
 *
 * Collects and reports performance metrics:
 * - Gas costs (deployment, operations)
 * - Dispute resolution timing
 * - Message counts and sizes
 */

import { ethers } from 'ethers';

// ============================================
// Types
// ============================================

export interface GasMetrics {
  deployment: {
    groth16Verifier: bigint;
    zkVerifier: bigint;
    rollupManager: bigint;
    disputeManager: bigint;
    total: bigint;
  };
  operations: {
    proposeStateRoot: bigint;
    initiateDispute: bigint;
    depositBond: bigint;
    submitProof: bigint;
    resolveDispute: bigint;
    triggerTimeout: bigint;
  };
}

export interface TimingMetrics {
  bisectionRounds: number;
  bisectionDuration: number; // ms
  proofGeneration: number; // ms
  onChainVerification: number; // ms
  totalDisputeResolution: number; // ms
}

export interface MessageMetrics {
  channelOpen: { count: number; totalBytes: number };
  channelAck: { count: number; totalBytes: number };
  bisectionMove: { count: number; totalBytes: number };
  proofRequest: { count: number; totalBytes: number };
  proofSubmit: { count: number; totalBytes: number };
  total: { count: number; totalBytes: number };
}

export interface ComparisonMetrics {
  // Traditional Optimistic Rollup (like Cannon)
  traditional: {
    disputeResolutionTime: number; // 7 days typical
    onChainMessages: number; // ~73 rounds
    gasPerMessage: bigint;
    totalGas: bigint;
  };
  // Our SI-RVP approach
  zkStateChannel: {
    disputeResolutionTime: number;
    onChainMessages: number; // 2-3 (initiate, submit proof, resolve)
    gasPerMessage: bigint;
    totalGas: bigint;
  };
  // Improvements
  improvements: {
    timeReduction: string; // percentage
    messageReduction: string; // percentage
    gasReduction: string; // percentage
  };
}

// ============================================
// Metrics Collector
// ============================================

export class MetricsCollector {
  private gasMetrics: Partial<GasMetrics> = {
    deployment: {
      groth16Verifier: 0n,
      zkVerifier: 0n,
      rollupManager: 0n,
      disputeManager: 0n,
      total: 0n,
    },
    operations: {
      proposeStateRoot: 0n,
      initiateDispute: 0n,
      depositBond: 0n,
      submitProof: 0n,
      resolveDispute: 0n,
      triggerTimeout: 0n,
    },
  };

  private timingMetrics: Partial<TimingMetrics> = {};
  private messageMetrics: MessageMetrics = {
    channelOpen: { count: 0, totalBytes: 0 },
    channelAck: { count: 0, totalBytes: 0 },
    bisectionMove: { count: 0, totalBytes: 0 },
    proofRequest: { count: 0, totalBytes: 0 },
    proofSubmit: { count: 0, totalBytes: 0 },
    total: { count: 0, totalBytes: 0 },
  };

  private timers: Map<string, number> = new Map();

  // ============================================
  // Gas Tracking
  // ============================================

  recordDeploymentGas(
    contract: keyof GasMetrics['deployment'],
    gasUsed: bigint
  ): void {
    if (this.gasMetrics.deployment) {
      this.gasMetrics.deployment[contract] = gasUsed;
      this.gasMetrics.deployment.total =
        this.gasMetrics.deployment.groth16Verifier +
        this.gasMetrics.deployment.zkVerifier +
        this.gasMetrics.deployment.rollupManager +
        this.gasMetrics.deployment.disputeManager;
    }
  }

  recordOperationGas(
    operation: keyof GasMetrics['operations'],
    gasUsed: bigint
  ): void {
    if (this.gasMetrics.operations) {
      this.gasMetrics.operations[operation] = gasUsed;
    }
  }

  // ============================================
  // Timing Tracking
  // ============================================

  startTimer(name: string): void {
    this.timers.set(name, Date.now());
  }

  stopTimer(name: string): number {
    const start = this.timers.get(name);
    if (!start) return 0;

    const duration = Date.now() - start;
    this.timers.delete(name);
    return duration;
  }

  recordBisection(rounds: number, duration: number): void {
    this.timingMetrics.bisectionRounds = rounds;
    this.timingMetrics.bisectionDuration = duration;
  }

  recordProofGeneration(duration: number): void {
    this.timingMetrics.proofGeneration = duration;
  }

  recordOnChainVerification(duration: number): void {
    this.timingMetrics.onChainVerification = duration;
  }

  recordTotalDisputeResolution(duration: number): void {
    this.timingMetrics.totalDisputeResolution = duration;
  }

  // ============================================
  // Message Tracking
  // ============================================

  recordMessage(
    type: keyof Omit<MessageMetrics, 'total'>,
    sizeBytes: number
  ): void {
    this.messageMetrics[type].count++;
    this.messageMetrics[type].totalBytes += sizeBytes;
    this.messageMetrics.total.count++;
    this.messageMetrics.total.totalBytes += sizeBytes;
  }

  // ============================================
  // Comparison Analysis
  // ============================================

  generateComparison(): ComparisonMetrics {
    // Traditional Optimistic Rollup assumptions (like Cannon)
    const TRADITIONAL_DISPUTE_TIME = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
    const TRADITIONAL_ROUNDS = 73; // Typical bisection rounds
    const TRADITIONAL_GAS_PER_MESSAGE = 50000n; // ~50k gas per on-chain bisection step

    const traditionalTotalGas =
      BigInt(TRADITIONAL_ROUNDS) * TRADITIONAL_GAS_PER_MESSAGE;

    // Our approach
    const zkDispute = {
      disputeResolutionTime: this.timingMetrics.totalDisputeResolution || 0,
      onChainMessages: 3, // initiate, submit proof, resolve
      gasPerMessage:
        (this.gasMetrics.operations?.initiateDispute || 0n) +
        (this.gasMetrics.operations?.submitProof || 0n) +
        (this.gasMetrics.operations?.resolveDispute || 0n),
      totalGas:
        (this.gasMetrics.operations?.initiateDispute || 0n) +
        (this.gasMetrics.operations?.submitProof || 0n) +
        (this.gasMetrics.operations?.resolveDispute || 0n),
    };

    // Calculate improvements
    const timeReduction =
      zkDispute.disputeResolutionTime > 0
        ? (
            ((TRADITIONAL_DISPUTE_TIME - zkDispute.disputeResolutionTime) /
              TRADITIONAL_DISPUTE_TIME) *
            100
          ).toFixed(2)
        : '99.9+';

    const messageReduction = (
      ((TRADITIONAL_ROUNDS - zkDispute.onChainMessages) / TRADITIONAL_ROUNDS) *
      100
    ).toFixed(2);

    const gasReduction =
      zkDispute.totalGas > 0n
        ? (
            (Number(traditionalTotalGas - zkDispute.totalGas) /
              Number(traditionalTotalGas)) *
            100
          ).toFixed(2)
        : '0';

    return {
      traditional: {
        disputeResolutionTime: TRADITIONAL_DISPUTE_TIME,
        onChainMessages: TRADITIONAL_ROUNDS,
        gasPerMessage: TRADITIONAL_GAS_PER_MESSAGE,
        totalGas: traditionalTotalGas,
      },
      zkStateChannel: {
        disputeResolutionTime: zkDispute.disputeResolutionTime,
        onChainMessages: zkDispute.onChainMessages,
        gasPerMessage: zkDispute.gasPerMessage / BigInt(zkDispute.onChainMessages || 1),
        totalGas: zkDispute.totalGas,
      },
      improvements: {
        timeReduction: `${timeReduction}%`,
        messageReduction: `${messageReduction}%`,
        gasReduction: `${gasReduction}%`,
      },
    };
  }

  // ============================================
  // Reporting
  // ============================================

  getGasMetrics(): GasMetrics {
    return this.gasMetrics as GasMetrics;
  }

  getTimingMetrics(): TimingMetrics {
    return this.timingMetrics as TimingMetrics;
  }

  getMessageMetrics(): MessageMetrics {
    return this.messageMetrics;
  }

  generateReport(): string {
    const comparison = this.generateComparison();

    let report = `
╔══════════════════════════════════════════════════════════════╗
║              SI-RVP - Performance Metrics Report             ║
╚══════════════════════════════════════════════════════════════╝

┌──────────────────────────────────────────────────────────────┐
│ Gas Costs                                                    │
└──────────────────────────────────────────────────────────────┘

  Deployment:
    Groth16Verifier:  ${this.gasMetrics.deployment?.groth16Verifier?.toString().padStart(12)}
    ZKVerifier:       ${this.gasMetrics.deployment?.zkVerifier?.toString().padStart(12)}
    RollupManager:    ${this.gasMetrics.deployment?.rollupManager?.toString().padStart(12)}
    DisputeManager:   ${this.gasMetrics.deployment?.disputeManager?.toString().padStart(12)}
    ────────────────────────────────────
    Total:            ${this.gasMetrics.deployment?.total?.toString().padStart(12)}

  Operations:
    proposeStateRoot: ${this.gasMetrics.operations?.proposeStateRoot?.toString().padStart(12)}
    initiateDispute:  ${this.gasMetrics.operations?.initiateDispute?.toString().padStart(12)}
    depositBond:      ${this.gasMetrics.operations?.depositBond?.toString().padStart(12)}
    submitProof:      ${this.gasMetrics.operations?.submitProof?.toString().padStart(12)}
    resolveDispute:   ${this.gasMetrics.operations?.resolveDispute?.toString().padStart(12)}

┌──────────────────────────────────────────────────────────────┐
│ Timing Metrics                                               │
└──────────────────────────────────────────────────────────────┘

  Bisection Rounds:        ${this.timingMetrics.bisectionRounds || 'N/A'}
  Bisection Duration:      ${this.timingMetrics.bisectionDuration || 'N/A'} ms
  Proof Generation:        ${this.timingMetrics.proofGeneration || 'N/A'} ms
  On-chain Verification:   ${this.timingMetrics.onChainVerification || 'N/A'} ms
  Total Dispute Resolution: ${this.timingMetrics.totalDisputeResolution || 'N/A'} ms

┌──────────────────────────────────────────────────────────────┐
│ Message Metrics                                              │
└──────────────────────────────────────────────────────────────┘

  Channel Open:    ${this.messageMetrics.channelOpen.count} messages, ${this.messageMetrics.channelOpen.totalBytes} bytes
  Channel Ack:     ${this.messageMetrics.channelAck.count} messages, ${this.messageMetrics.channelAck.totalBytes} bytes
  Bisection Move:  ${this.messageMetrics.bisectionMove.count} messages, ${this.messageMetrics.bisectionMove.totalBytes} bytes
  Proof Request:   ${this.messageMetrics.proofRequest.count} messages, ${this.messageMetrics.proofRequest.totalBytes} bytes
  Proof Submit:    ${this.messageMetrics.proofSubmit.count} messages, ${this.messageMetrics.proofSubmit.totalBytes} bytes
  ────────────────────────────────────
  Total:           ${this.messageMetrics.total.count} messages, ${this.messageMetrics.total.totalBytes} bytes

┌──────────────────────────────────────────────────────────────┐
│ Comparison: Traditional vs SI-RVP                  │
└──────────────────────────────────────────────────────────────┘

                        Traditional     SI-RVP    Improvement
  ──────────────────────────────────────────────────────────────────────
  Dispute Time:         7 days          ${(comparison.zkStateChannel.disputeResolutionTime / 1000).toFixed(1)}s              ${comparison.improvements.timeReduction}
  On-chain Messages:    ${comparison.traditional.onChainMessages}              ${comparison.zkStateChannel.onChainMessages}                   ${comparison.improvements.messageReduction}
  Total Gas:            ${comparison.traditional.totalGas.toString().padStart(10)}      ${comparison.zkStateChannel.totalGas.toString().padStart(10)}          ${comparison.improvements.gasReduction}

╔══════════════════════════════════════════════════════════════╗
║                    End of Report                             ║
╚══════════════════════════════════════════════════════════════╝
`;

    return report;
  }

  toJSON(): object {
    return {
      gas: this.gasMetrics,
      timing: this.timingMetrics,
      messages: this.messageMetrics,
      comparison: this.generateComparison(),
    };
  }
}

// ============================================
// Singleton Instance
// ============================================

export const metrics = new MetricsCollector();

export default MetricsCollector;
