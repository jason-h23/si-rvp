/**
 * P2P Reconnection Guard Tests
 *
 * Verifies that reconnection logic correctly handles:
 * - Intentional close (closed flag suppresses reconnect)
 * - connect() rejection after close()
 */

import { expect } from 'chai';
import { ethers } from 'ethers';
import type { Suite } from 'mocha';
import { P2PNode } from '../src/common/p2p';

describe('P2P Reconnection Guards', function (this: Suite) {
  this.timeout(15000);

  let serverNode: P2PNode;
  let clientNode: P2PNode;
  let serverWallet: ethers.HDNodeWallet;

  // Random port to avoid conflicts with other test suites
  const BASE_PORT = 9100 + Math.floor(Math.random() * 800);

  afterEach(async function () {
    try { await clientNode?.close(); } catch { /* already closed */ }
    try { await serverNode?.close(); } catch { /* already closed */ }
  });

  function createPair(): { server: P2PNode; client: P2PNode; serverAddr: string } {
    serverWallet = ethers.Wallet.createRandom();
    const clientWallet = ethers.Wallet.createRandom();
    const server = new P2PNode(serverWallet as unknown as ethers.Wallet, {});
    const client = new P2PNode(clientWallet as unknown as ethers.Wallet, {});
    return { server, client, serverAddr: serverWallet.address };
  }

  it('should not reconnect after close() is called', async function () {
    const port = BASE_PORT;
    const { server, client, serverAddr } = createPair();
    serverNode = server;
    clientNode = client;

    server.startServer(port);
    await client.connect(`ws://localhost:${port}`, serverAddr);
    expect(client.isConnected(serverAddr)).to.be.true;

    // Intentionally close the client
    await client.close();

    // Wait longer than the first reconnect delay (1000ms)
    await new Promise(r => setTimeout(r, 2000));

    // Client should remain disconnected — closed flag prevents reconnection
    expect(client.isConnected(serverAddr)).to.be.false;
    expect(client.getConnectedPeers()).to.have.length(0);
  });

  it('should not reconnect when server shuts down after client close()', async function () {
    const port = BASE_PORT + 1;
    const { server, client, serverAddr } = createPair();
    serverNode = server;
    clientNode = client;

    server.startServer(port);
    await client.connect(`ws://localhost:${port}`, serverAddr);
    expect(client.isConnected(serverAddr)).to.be.true;

    // Close client first, then server — simulates graceful shutdown sequence
    await client.close();
    await server.close();

    await new Promise(r => setTimeout(r, 2000));

    // No zombie reconnection attempts
    expect(client.getConnectedPeers()).to.have.length(0);
  });

  it('should prevent duplicate reconnect scheduling (reconnecting guard)', async function () {
    const port = BASE_PORT + 3;
    const { server, client, serverAddr } = createPair();
    serverNode = server;
    clientNode = client;

    server.startServer(port);
    await client.connect(`ws://localhost:${port}`, serverAddr);
    expect(client.isConnected(serverAddr)).to.be.true;

    // Verify initial state: no reconnection in progress
    expect((client as any).reconnecting).to.be.false;

    // Terminate the underlying WebSocket to trigger close event → scheduleReconnect
    const ws = (client as any).clients.get(serverAddr);
    ws.terminate();

    // Allow event loop to process the close event
    await new Promise(r => setTimeout(r, 100));

    // reconnecting guard should be set after first scheduleReconnect call
    expect((client as any).reconnecting).to.be.true;

    // Only one reconnect timer should exist (guard prevents duplicates)
    expect((client as any).reconnectTimer).to.not.be.null;

    // Clean up: close client to clear pending reconnect timers
    await client.close();
  });

  it('should reject connect() after close() has been called', async function () {
    const port = BASE_PORT + 2;
    const { server, client, serverAddr } = createPair();
    serverNode = server;
    clientNode = client;

    server.startServer(port);
    await client.connect(`ws://localhost:${port}`, serverAddr);
    await client.close();

    // Attempting to connect on a closed node should throw
    try {
      await client.connect(`ws://localhost:${port}`, serverAddr);
      expect.fail('Should have thrown on connect after close');
    } catch (err) {
      expect((err as Error).message).to.include('closed');
    }
  });
});
