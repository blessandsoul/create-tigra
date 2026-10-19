/**
 * createShutdown (../shutdown.ts): exit 0 only after a signal and a clean
 * close, 1 after a crash, a failed start or a failed close, one close no matter
 * how often it is called, and the 8 s deadline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShutdown, SHUTDOWN_DEADLINE_MS, type ShutdownReason } from '../shutdown.js';

const logger = { info: vi.fn(), error: vi.fn(), fatal: vi.fn() };
const exit = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('exit codes', () => {
  it.each(['SIGTERM', 'SIGINT'] as const)('%s with a clean close exits 0', async (reason) => {
    const close = vi.fn().mockResolvedValue(undefined);
    await createShutdown({ close, exit, logger })(reason);
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(logger.info).toHaveBeenCalledWith(`[SERVER] Received ${reason} - shutting down gracefully`);
    expect(logger.info).toHaveBeenCalledWith('[SERVER] Shutdown complete');
  });

  it.each(['uncaughtException', 'unhandledRejection', 'startup-error'] as const)(
    '%s exits 1 even though the close went fine',
    async (reason) => {
      const close = vi.fn().mockResolvedValue(undefined);
      await createShutdown({ close, exit, logger })(reason);
      expect(close).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    },
  );

  it('a close that throws exits 1 and logs the error under err', async () => {
    const failure = new Error('redis quit failed');
    await createShutdown({ close: vi.fn().mockRejectedValue(failure), exit, logger })('SIGTERM');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(logger.error).toHaveBeenCalledWith({ err: failure }, '[SERVER] Error during shutdown');
  });
});

describe('only one shutdown', () => {
  it('a second signal starts no second close and no second exit', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const shutdown = createShutdown({ close, exit, logger });
    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT'), shutdown('SIGTERM')]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('a crash while a signal shutdown is closing still makes the exit code 1', async () => {
    let finishClose!: () => void;
    const close = vi.fn(() => new Promise<void>((resolve) => (finishClose = resolve)));
    const shutdown = createShutdown({ close, exit, logger });
    const closing = shutdown('SIGTERM');
    await shutdown('uncaughtException' satisfies ShutdownReason);
    finishClose();
    await closing;
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});

describe('deadline', () => {
  it('a close that hangs is cut off at 8 s with a fatal line and exit 1', async () => {
    const close = vi.fn(() => new Promise<void>(() => {}));
    void createShutdown({ close, exit, logger })('SIGTERM');
    vi.advanceTimersByTime(SHUTDOWN_DEADLINE_MS - 1);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(logger.fatal).toHaveBeenCalledWith('[SERVER] Shutdown did not finish within 8s; exiting');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('8 s fits inside Docker’s default 10 s stop timeout', () => {
    expect(SHUTDOWN_DEADLINE_MS).toBe(8_000);
  });

  it('a close that finishes in time cancels the deadline', async () => {
    await createShutdown({ close: vi.fn().mockResolvedValue(undefined), exit, logger, deadlineMs: 50 })('SIGTERM');
    vi.advanceTimersByTime(1_000);
    expect(logger.fatal).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });
});
