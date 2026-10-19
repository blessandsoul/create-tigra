/**
 * Cleanup Expired Auth Records Job
 *
 * Removes expired refresh tokens and sessions from the database, and expired
 * automatic IP blocks from Redis (libs/ip-block.ts). Runs about a minute after
 * start, then every hour (jobs/schedule.ts).
 */

import type { FastifyInstance } from 'fastify';
import { prisma } from '@libs/prisma.js';
import { logger } from '@libs/logger.js';
import { pruneExpiredAutoBlocks } from '@libs/ip-block.js';
import { startRecurringJob } from './schedule.js';

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const FIRST_RUN_DELAY_MS = 60 * 1000;

/** One cleanup pass; exported so tests (and an operator script) can run it directly. */
export async function cleanupExpiredAuth(
  now: Date = new Date(),
): Promise<{ tokens: number; sessions: number; autoBlocks: number }> {
  const deletedTokens = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: now } },
  });

  const deletedSessions = await prisma.session.deleteMany({
    where: { expiresAt: { lt: now } },
  });

  // Redis, separate from the database: never fails the pass (fail-open).
  const autoBlocks = await pruneExpiredAutoBlocks(now.getTime() / 1000);

  if (deletedTokens.count > 0 || deletedSessions.count > 0 || autoBlocks > 0) {
    logger.info(
      { deletedTokens: deletedTokens.count, deletedSessions: deletedSessions.count, prunedAutoBlocks: autoBlocks },
      'Expired auth records cleaned up',
    );
  }
  return { tokens: deletedTokens.count, sessions: deletedSessions.count, autoBlocks };
}

export function startCleanupExpiredAuthJob(app: FastifyInstance): void {
  startRecurringJob(app, {
    name: 'cleanup-expired-auth',
    intervalMs: INTERVAL_MS,
    firstRunDelayMs: FIRST_RUN_DELAY_MS,
    run: () => cleanupExpiredAuth(),
  });
}
