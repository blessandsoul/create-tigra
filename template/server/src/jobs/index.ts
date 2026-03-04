/**
 * Jobs Registry
 *
 * Registers all background jobs with the Fastify instance.
 * Each job manages its own interval and cleanup via onClose hook.
 */

import type { FastifyInstance } from 'fastify';
import { startCleanupExpiredAuthJob } from './cleanup-expired-auth.job.js';
import { startCleanupDeletedAccountsJob } from './cleanup-deleted-accounts.job.js';

/**
 * Registers all background jobs
 *
 * @param app - Fastify instance (used for onClose cleanup hooks)
 */
export function registerJobs(app: FastifyInstance): void {
  startCleanupExpiredAuthJob(app);
  startCleanupDeletedAccountsJob(app);
}
