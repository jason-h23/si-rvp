/**
 * SI-RVP - Graceful Shutdown Utility
 *
 * Installs SIGINT/SIGTERM handlers with a safety timeout.
 */

import { logger } from './logger';

const SHUTDOWN_TIMEOUT_MS = 5000;

/**
 * Install graceful shutdown handlers for SIGINT and SIGTERM.
 * If shutdownFn does not resolve within timeoutMs, force-exits with code 1.
 */
export function installGracefulShutdown(
  label: string,
  shutdownFn: () => Promise<void>,
  timeoutMs: number = SHUTDOWN_TIMEOUT_MS
): void {
  let shuttingDown = false;
  const handler = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(label, 'Shutdown signal received, shutting down...');
    const timeout = setTimeout(() => {
      logger.error(label, `Shutdown timed out after ${timeoutMs}ms, forcing exit`);
      process.exit(1);
    }, timeoutMs);
    try {
      await shutdownFn();
    } catch (err) {
      logger.error(label, `Shutdown error: ${(err as Error).message}`);
    }
    clearTimeout(timeout);
    process.exit(0);
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
}
