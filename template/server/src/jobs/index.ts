/**
 * Jobs Registry
 *
 * Registers all background jobs with the Fastify instance. They run inside the
 * server process, each once shortly after start and then on its interval
 * (jobs/schedule.ts), so a deploy never postpones them. With several server
 * processes (replicas) each runs them too; that is safe, the jobs are
 * idempotent (the purge treats an account another process removed as done).
 *
 * - cleanup-expired-auth: hourly, expired refresh tokens and sessions, and
 *   expired automatic IP blocks in Redis
 * - purge-deleted-accounts: daily, accounts deleted more than 30 days ago
 * - refresh-cloudflare-ranges: daily, Cloudflare's edge IP ranges (not in tests)
 */

import type { FastifyInstance } from 'fastify';
import { startCleanupExpiredAuthJob } from './cleanup-expired-auth.job.js';
import { startCleanupDeletedAccountsJob } from './cleanup-deleted-accounts.job.js';
import { startRefreshCloudflareRangesJob } from './refresh-cloudflare-ranges.job.js';

/**
 * Registers all background jobs
 *
 * @param app - Fastify instance (used for onClose cleanup hooks)
 */
export function registerJobs(app: FastifyInstance): void {
  startCleanupExpiredAuthJob(app);
  startCleanupDeletedAccountsJob(app);
  startRefreshCloudflareRangesJob(app);
}
