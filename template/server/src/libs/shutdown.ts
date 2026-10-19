/**
 * Process shutdown with honest exit codes and a deadline (wired in server.ts).
 *
 * Exit codes are how Docker, Coolify and any restart policy tell a deploy or a
 * stop from a crash:
 * - SIGTERM / SIGINT (a deploy, `docker stop`, Ctrl+C): 0 once everything closed;
 * - an uncaught exception, an unhandled rejection or a failed start: 1, even
 *   when the cleanup itself went fine (it used to be 0, so a crash or a server
 *   that never started looked like a clean stop);
 * - a cleanup that throws: 1.
 *
 * The deadline: `docker stop` (and Coolify's rolling updates) wait 10 s after
 * SIGTERM, then SIGKILL, which skips every log line. If closing hangs (a
 * request that never ends, a database that does not answer), the process logs
 * a fatal line and exits 1 at SHUTDOWN_DEADLINE_MS instead, inside that window.
 */
import type { Logger } from 'pino';

export type ShutdownReason =
  | 'SIGINT'
  | 'SIGTERM'
  | 'uncaughtException'
  | 'unhandledRejection'
  | 'startup-error';

/** Reasons that mean something went wrong: the process exits 1 whatever the cleanup does. */
const FAILURE_REASONS: ReadonlySet<ShutdownReason> = new Set([
  'uncaughtException',
  'unhandledRejection',
  'startup-error',
]);

/** Below Docker's default 10 s stop timeout, so our own fatal line is written before SIGKILL. */
export const SHUTDOWN_DEADLINE_MS = 8_000;

export interface ShutdownOptions {
  /** Closes the app, then Redis, then the database. */
  close: () => Promise<void>;
  /** process.exit in production; a spy in tests. */
  exit: (code: number) => void;
  logger: Pick<Logger, 'info' | 'error' | 'fatal'>;
  deadlineMs?: number;
}

/**
 * Returns the one shutdown function for the process. Only the first call
 * closes anything; later calls (a second signal, an exception thrown while
 * closing) start nothing new, but a failure reason arriving later still turns
 * the final exit code into 1.
 *
 * The deadline timer is deliberately NOT unref'd: every path ends in exit(),
 * so it never keeps a finished process alive, and if close() hung with nothing
 * else holding the event loop, an unref'd timer would let Node end on its own
 * with exit code 0.
 */
export function createShutdown({
  close,
  exit,
  logger,
  deadlineMs = SHUTDOWN_DEADLINE_MS,
}: ShutdownOptions): (reason: ShutdownReason) => Promise<void> {
  let started = false;
  let failed = false;

  return async function shutdown(reason: ShutdownReason): Promise<void> {
    if (FAILURE_REASONS.has(reason)) failed = true;
    if (started) return;
    started = true;

    logger.info(`[SERVER] Received ${reason} - shutting down gracefully`);
    const deadline = setTimeout(() => {
      logger.fatal(`[SERVER] Shutdown did not finish within ${deadlineMs / 1000}s; exiting`);
      exit(1);
    }, deadlineMs);

    try {
      await close();
      clearTimeout(deadline);
      logger.info('[SERVER] Shutdown complete');
      exit(failed ? 1 : 0);
    } catch (error) {
      clearTimeout(deadline);
      logger.error({ err: error }, '[SERVER] Error during shutdown');
      exit(1);
    }
  };
}
