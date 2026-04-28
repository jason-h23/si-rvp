/**
 * SI-RVP - P2P Communication Layer
 *
 * WebSocket-based sequencer-challenger communication
 */

import WebSocket, { WebSocketServer } from 'ws';
import { ethers } from 'ethers';
import { P2PMessage, ChannelMessageType, BisectionMove } from './types';
import { logger } from './logger';

// ============================================
// Message Types
// ============================================
export interface ChannelOpenPayload {
  disputeId: string;
  batchIndex: bigint;
  sequencer: string;
  challenger: string;
  sequencerClaim: string;
  challengerClaim: string;
  startStep: bigint;
  endStep: bigint;
}

export interface ChannelAckPayload {
  disputeId: string;
  accepted: boolean;
}

export interface BisectionMovePayload {
  move: BisectionMove;
}

export interface ProofRequestPayload {
  disputeId: string;
  disputedStep: bigint;
  preStateHash: string;
  postStateHash: string;
}

export interface ProofSubmitPayload {
  disputeId: string;
  proof: {
    a: [string, string];
    b: [[string, string], [string, string]];
    c: [string, string];
  };
  publicInputs: string[];
}

export interface ChannelClosePayload {
  disputeId: string;
  reason: 'completed' | 'timeout' | 'error';
  winner?: 'sequencer' | 'challenger';
}

// ============================================
// Message Handler Interface
// ============================================
export interface P2PMessageHandler {
  onChannelOpen?(payload: ChannelOpenPayload, from: string): Promise<void>;
  onChannelAck?(payload: ChannelAckPayload, from: string): Promise<void>;
  onBisectionMove?(payload: BisectionMovePayload, from: string): Promise<void>;
  onProofRequest?(payload: ProofRequestPayload, from: string): Promise<void>;
  onProofSubmit?(payload: ProofSubmitPayload, from: string): Promise<void>;
  onChannelClose?(payload: ChannelClosePayload, from: string): Promise<void>;
}

// ============================================
// Validation helpers
// ============================================

/** Allowed message type literals for runtime checking */
const VALID_MESSAGE_TYPES = new Set([
  'channel_open',
  'channel_ack',
  'bisection_move',
  'proof_request',
  'proof_submit',
  'channel_close',
]);

/**
 * Validate that a parsed JSON value matches the P2PMessage shape.
 * Returns a typed P2PMessage or throws with a descriptive error.
 */
function validateP2PMessage(value: unknown): P2PMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('P2P message must be a JSON object');
  }

  const msg = value as Record<string, unknown>;

  if (typeof msg['type'] !== 'string' || !VALID_MESSAGE_TYPES.has(msg['type'])) {
    throw new Error(`Invalid or missing message type: ${String(msg['type'])}`);
  }
  if (typeof msg['from'] !== 'string' || !msg['from'].startsWith('0x') || msg['from'].length !== 42) {
    throw new Error(`Invalid or missing 'from' address: ${String(msg['from'])}`);
  }
  if (typeof msg['to'] !== 'string' || !msg['to'].startsWith('0x') || msg['to'].length !== 42) {
    throw new Error(`Invalid or missing 'to' address: ${String(msg['to'])}`);
  }
  if (typeof msg['signature'] !== 'string' || msg['signature'].length === 0) {
    throw new Error("Missing or empty 'signature'");
  }
  if (typeof msg['timestamp'] !== 'number' || !Number.isFinite(msg['timestamp']) || msg['timestamp'] <= 0) {
    throw new Error(`Invalid or missing 'timestamp': ${String(msg['timestamp'])}`);
  }
  if (typeof msg['sequence'] !== 'number' || !Number.isInteger(msg['sequence']) || msg['sequence'] < 0) {
    throw new Error(`Invalid or missing 'sequence': ${String(msg['sequence'])}`);
  }
  if (!('payload' in msg)) {
    throw new Error("Missing 'payload' field");
  }

  return msg as unknown as P2PMessage;
}

// ============================================
// P2P Node (WebSocket Server/Client)
// ============================================
export class P2PNode {
  private server?: WebSocketServer;
  private clients: Map<string, WebSocket> = new Map();
  private handlers: P2PMessageHandler;
  private signer: ethers.Wallet;
  private address: string;
  /** Monotonic outbound sequence counter — incremented per sent message */
  private outboundSequence: number = 0;
  /** Track highest seen sequence per sender to prevent replays */
  private inboundSequences: Map<string, number> = new Map();
  /** Reconnection state */
  private reconnectAttempts: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  /** Suppresses reconnection after close() has been called */
  private closed = false;
  /** Prevents duplicate reconnect scheduling from concurrent close+error events */
  private reconnecting = false;

  constructor(signer: ethers.Wallet, handlers: P2PMessageHandler) {
    this.signer = signer;
    this.address = signer.address;
    this.handlers = handlers;
  }

  /**
   * Start WebSocket server (for sequencer)
   */
  startServer(port: number): void {
    this.server = new WebSocketServer({ port });
    logger.info('P2P', `Server started on port ${port}`);

    this.server.on('connection', (ws, req) => {
      const clientAddr = req.socket.remoteAddress || 'unknown';
      logger.info('P2P', `Client connected from ${clientAddr}`);

      ws.on('message', (data) => {
        this.handleMessage(ws, data.toString());
      });

      ws.on('close', () => {
        logger.info('P2P', `Client disconnected: ${clientAddr}`);
        // Remove from clients map
        for (const [addr, client] of this.clients.entries()) {
          if (client === ws) {
            this.clients.delete(addr);
            break;
          }
        }
      });

      ws.on('error', (err) => {
        logger.error('P2P', 'WebSocket error:', err);
      });
    });
  }

  /**
   * Connect to peer (for challenger)
   */
  async connect(url: string, peerAddress: string): Promise<void> {
    if (this.closed) {
      throw new Error('P2PNode is closed — create a new instance');
    }
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);

      ws.on('open', () => {
        logger.info('P2P', `Connected to ${url}`);
        this.clients.set(peerAddress, ws);
        resolve();
      });

      ws.on('message', (data) => {
        this.handleMessage(ws, data.toString());
      });

      ws.on('close', () => {
        logger.info('P2P', `Disconnected from ${url}`);
        this.clients.delete(peerAddress);
        this.scheduleReconnect(url, peerAddress);
      });

      ws.on('error', (err) => {
        logger.error('P2P', 'Connection error:', err);
        reject(err);
      });
    });
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(url: string, peerAddress: string): void {
    if (this.closed || this.reconnecting) return;
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      logger.error('P2P', `Max reconnect attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached for ${peerAddress}`);
      return;
    }
    this.reconnecting = true;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 32000);
    logger.info('P2P', `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;
      try {
        await this.connect(url, peerAddress);
        this.reconnectAttempts = 0;
        this.reconnecting = false;
      } catch (err) {
        logger.error('P2P', `Reconnect failed: ${(err as Error).message}`);
        this.reconnecting = false;
        this.scheduleReconnect(url, peerAddress);
      }
    }, delay);
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(ws: WebSocket, data: string): Promise<void> {
    try {
      // Parse then validate shape before trusting any field
      let message: P2PMessage;
      try {
        message = validateP2PMessage(JSON.parse(data));
      } catch (validationErr) {
        logger.error('P2P', 'Message validation failed:', validationErr);
        return;
      }

      // Verify signature (covers type, from, to, timestamp, sequence, payload hash)
      if (!this.verifyMessageSignature(message)) {
        logger.error('P2P', `Invalid signature from ${message.from}`);
        return;
      }

      // Anti-replay: check inbound sequence
      const lastSeen = this.inboundSequences.get(message.from) ?? -1;
      if (message.sequence <= lastSeen) {
        logger.error('P2P', `Replay detected from ${message.from}: sequence ${message.sequence} <= ${lastSeen}`);
        return;
      }
      this.inboundSequences.set(message.from, message.sequence);

      // Store client reference if not exists
      if (!this.clients.has(message.from)) {
        this.clients.set(message.from, ws);
      }

      // Route to handler
      switch (message.type) {
        case 'channel_open':
          await this.handlers.onChannelOpen?.(message.payload as ChannelOpenPayload, message.from);
          break;
        case 'channel_ack':
          await this.handlers.onChannelAck?.(message.payload as ChannelAckPayload, message.from);
          break;
        case 'bisection_move':
          await this.handlers.onBisectionMove?.(message.payload as BisectionMovePayload, message.from);
          break;
        case 'proof_request':
          await this.handlers.onProofRequest?.(message.payload as ProofRequestPayload, message.from);
          break;
        case 'proof_submit':
          await this.handlers.onProofSubmit?.(message.payload as ProofSubmitPayload, message.from);
          break;
        case 'channel_close':
          await this.handlers.onChannelClose?.(message.payload as ChannelClosePayload, message.from);
          break;
        default:
          logger.warn('P2P', `Unknown message type: ${message.type}`);
      }
    } catch (err) {
      logger.error('P2P', 'Error handling message:', err);
    }
  }

  /**
   * Send message to peer
   */
  async send(to: string, type: P2PMessage['type'], payload: unknown): Promise<void> {
    const ws = this.clients.get(to);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Not connected to peer: ${to}`);
    }

    // Build unsigned message (immutable — no mutation after construction)
    const unsigned: P2PMessage = {
      type,
      payload,
      from: this.address,
      to,
      signature: '',
      timestamp: Date.now(),
      sequence: this.outboundSequence++,
    };

    // Sign then attach signature — produce a new object to preserve immutability
    const signature = await this.signMessage(unsigned);
    const message: P2PMessage = { ...unsigned, signature };

    // Custom serializer to handle BigInt
    const serialized = JSON.stringify(message, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );
    await new Promise<void>((resolve, reject) => {
      ws.send(serialized, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Broadcast to all connected peers
   */
  async broadcast(type: P2PMessage['type'], payload: unknown): Promise<void> {
    for (const [addr] of this.clients) {
      try {
        await this.send(addr, type, payload);
      } catch (err) {
        logger.error('P2P', `Failed to send to ${addr}:`, err);
      }
    }
  }

  /**
   * Sign message.
   *
   * The signature covers: type, from, to, timestamp, sequence, and the
   * keccak256 hash of the JSON-serialised payload.  Including the payload
   * hash prevents an attacker from replacing the payload after the message
   * is signed.  The sequence (nonce) prevents replay attacks.
   */
  private async signMessage(message: P2PMessage): Promise<string> {
    const payloadJson = JSON.stringify(message.payload, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );
    const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(payloadJson));

    const hash = ethers.keccak256(
      ethers.solidityPacked(
        ['string', 'address', 'address', 'uint256', 'uint256', 'bytes32'],
        [message.type, message.from, message.to, message.timestamp, message.sequence, payloadHash]
      )
    );
    return await this.signer.signMessage(ethers.getBytes(hash));
  }

  /**
   * Verify message signature.
   *
   * Must reconstruct exactly the same hash as signMessage() — including the
   * payload hash and sequence — so that any tampering with either field is
   * detected.
   */
  private verifyMessageSignature(message: P2PMessage): boolean {
    try {
      const payloadJson = JSON.stringify(message.payload, (_, value) =>
        typeof value === 'bigint' ? value.toString() : value
      );
      const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(payloadJson));

      const hash = ethers.keccak256(
        ethers.solidityPacked(
          ['string', 'address', 'address', 'uint256', 'uint256', 'bytes32'],
          [message.type, message.from, message.to, message.timestamp, message.sequence, payloadHash]
        )
      );
      const recovered = ethers.verifyMessage(ethers.getBytes(hash), message.signature);
      return recovered.toLowerCase() === message.from.toLowerCase();
    } catch {
      return false;
    }
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    for (const ws of this.clients.values()) {
      ws.close();
    }
    this.clients.clear();
    this.inboundSequences.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
    }
  }

  /**
   * Get connected peers
   */
  getConnectedPeers(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Check if connected to peer
   */
  isConnected(address: string): boolean {
    const ws = this.clients.get(address);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }
}
