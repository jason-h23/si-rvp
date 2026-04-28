/**
 * Graceful Shutdown Utility Tests
 *
 * Verifies:
 * - Double-signal guard (second signal is ignored)
 * - shutdownFn error handling (doesn't crash, still exits)
 * - Normal shutdown flow
 * - Timeout force-exit path (code 1)
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { installGracefulShutdown } from '../src/common/shutdown';

describe('installGracefulShutdown', () => {
  let registeredHandlers: Map<string, (() => Promise<void>)>;
  let onStub: sinon.SinonStub;
  let exitStub: sinon.SinonStub;

  beforeEach(() => {
    registeredHandlers = new Map();

    // Stub process.on to capture signal handlers
    onStub = sinon.stub(process, 'on').callsFake(((event: string, handler: () => Promise<void>) => {
      if (event === 'SIGINT' || event === 'SIGTERM') {
        registeredHandlers.set(event, handler);
      }
      return process;
    }) as any);

    // Stub process.exit to capture exit code without actually exiting
    exitStub = sinon.stub(process, 'exit');
  });

  afterEach(() => {
    onStub.restore();
    exitStub.restore();
  });

  it('should register both SIGINT and SIGTERM handlers', () => {
    installGracefulShutdown('Test', async () => {});
    expect(registeredHandlers.has('SIGINT')).to.be.true;
    expect(registeredHandlers.has('SIGTERM')).to.be.true;
  });

  it('should call shutdownFn and exit with 0 on signal', async () => {
    let shutdownCalled = false;
    installGracefulShutdown('Test', async () => { shutdownCalled = true; });

    const handler = registeredHandlers.get('SIGINT')!;
    await handler();

    expect(shutdownCalled).to.be.true;
    expect(exitStub.calledWith(0)).to.be.true;
  });

  it('should ignore second signal (double-signal guard)', async () => {
    let callCount = 0;
    installGracefulShutdown('Test', async () => {
      callCount++;
      // Simulate slow shutdown
      await new Promise(r => setTimeout(r, 100));
    });

    const sigint = registeredHandlers.get('SIGINT')!;
    const sigterm = registeredHandlers.get('SIGTERM')!;

    // Fire both signals concurrently
    await Promise.all([sigint(), sigterm()]);

    // shutdownFn should only be called once
    expect(callCount).to.equal(1);
    expect(exitStub.calledWith(0)).to.be.true;
  });

  it('should catch shutdownFn errors and still exit with 0', async () => {
    installGracefulShutdown('Test', async () => {
      throw new Error('shutdown failed');
    });

    const handler = registeredHandlers.get('SIGINT')!;
    await handler();

    // Should not crash, should still exit cleanly
    expect(exitStub.calledWith(0)).to.be.true;
  });

  it('should use custom timeout value', () => {
    // Just verify it doesn't throw with custom timeout
    installGracefulShutdown('Test', async () => {}, 1000);
    expect(registeredHandlers.has('SIGINT')).to.be.true;
  });

  it('should force-exit with code 1 when shutdown times out', () => {
    const clock = sinon.useFakeTimers();

    try {
      // shutdownFn that never resolves — simulates hung shutdown
      installGracefulShutdown('Test', () => new Promise(() => {}), 100);

      const handler = registeredHandlers.get('SIGINT')!;
      handler(); // don't await — it never resolves

      // Advance clock past timeout threshold
      clock.tick(101);

      expect(exitStub.calledWith(1)).to.be.true;
    } finally {
      clock.restore();
    }
  });
});
