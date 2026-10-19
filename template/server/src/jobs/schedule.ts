/**
 * The one way background jobs are scheduled (see jobs/index.ts).
 *
 * A job runs once shortly after start, then every interval. Running only on
 * setInterval (as the jobs used to) waits a FULL interval from boot, and every
 * deploy or restart starts that wait again: a project deployed at least once a
 * day never ran its daily purge at all.
 *
 * - The first run is delayed (firstRunDelayMs) so it stays off the startup path.
 * - Timers are unref'd: they never keep the process alive on their own, and
 *   app.close() (graceful shutdown) clears them.
 * - A failing run is logged and the schedule goes on; one bad run never stops
 *   the job. Runs never overlap: a run that is still busy skips the next tick.
 */
import type { FastifyInstance } from 'fastify';
import { logger } from '@libs/logger.js';

export interface RecurringJob {
  /** Short name for the logs, e.g. 'purge-deleted-accounts'. */
  name: string;
  intervalMs: number;
  firstRunDelayMs: number;
  run: () => Promise<unknown>;
}

export function startRecurringJob(app: FastifyInstance, job: RecurringJob): void {
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return; // the previous run is still busy
    running = true;
    try {
      await job.run();
    } catch (error) {
      logger.error({ err: error, job: job.name }, `[JOB] ${job.name} failed`);
    } finally {
      running = false;
    }
  };

  const firstRun = setTimeout(() => void tick(), job.firstRunDelayMs);
  const interval = setInterval(() => void tick(), job.intervalMs);
  firstRun.unref();
  interval.unref();

  app.addHook('onClose', async () => {
    clearTimeout(firstRun);
    clearInterval(interval);
  });
}
