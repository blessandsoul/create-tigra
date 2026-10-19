/**
 * Cleanup Deleted Accounts Job
 *
 * Permanently purges soft-deleted user accounts after a 30-day retention period.
 * Deletes all of the user's media from disk first (public AND private tier),
 * then hard-deletes the user record (cascades to refresh tokens and sessions;
 * IP blocks the user created as an admin are kept, with blockedBy set to NULL).
 *
 * Files first, row last: while the row exists, the account is found again by
 * the next run, so a failed file deletion is simply retried. The old order
 * (row first) left files no run could ever find again, a public avatar
 * included. (The public avatar is normally gone already: deleting the account
 * removes it at once, see usersService.deleteAccount.)
 *
 * Runs about a minute after start, then once a day (jobs/schedule.ts): a
 * deploy or restart never pushes the purge back by another day.
 * `purgeDeletedAccounts()` is exported so it can also be run on demand (tests,
 * an operator script) without waiting for the schedule.
 */

import type { FastifyInstance } from 'fastify';
import { prisma } from '@libs/prisma.js';
import { logger } from '@libs/logger.js';
import { fileStorageService } from '@libs/storage/file-storage.service.js';
import { startRecurringJob } from './schedule.js';

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FIRST_RUN_DELAY_MS = 60 * 1000;
/** Days a soft-deleted account is kept (restorable by an admin) before the purge. */
export const RETENTION_DAYS = 30;

export interface PurgeResult {
  found: number;
  purged: number;
  failed: number;
}

/**
 * Purge every account soft-deleted more than RETENTION_DAYS ago.
 *
 * One failing account is logged and skipped; it never stops the others. A
 * failure here is a real problem (data kept past its promised deletion), so it
 * is logged at error level with the user id.
 */
export async function purgeDeletedAccounts(now: Date = new Date()): Promise<PurgeResult> {
  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

  // Find users soft-deleted more than 30 days ago
  const usersToDelete = await prisma.user.findMany({
    where: {
      deletedAt: {
        not: null,
        lt: cutoffDate,
      },
    },
    select: {
      id: true,
    },
  });

  const result: PurgeResult = { found: usersToDelete.length, purged: 0, failed: 0 };

  for (const user of usersToDelete) {
    try {
      // Media first (no-op if the folders don't exist). If it throws, the row
      // stays and the next run retries this account.
      await fileStorageService.deleteUserMedia(user.id);

      // Then the row (cascades to RefreshToken + Session). If only this fails,
      // the next run finds the account again; its media is already gone.
      await prisma.user.delete({
        where: { id: user.id },
      });

      result.purged++;
    } catch (error) {
      result.failed++;
      logger.error({ err: error, userId: user.id }, 'Failed to purge deleted account');
    }
  }

  // One line per run, also when nothing was due: the log then shows the purge
  // really runs (it used to say nothing unless it found an account).
  logger.info(
    { purgedCount: result.purged, failedCount: result.failed, totalFound: result.found },
    'Deleted accounts purge complete',
  );
  return result;
}

export function startCleanupDeletedAccountsJob(app: FastifyInstance): void {
  startRecurringJob(app, {
    name: 'purge-deleted-accounts',
    intervalMs: INTERVAL_MS,
    firstRunDelayMs: FIRST_RUN_DELAY_MS,
    run: () => purgeDeletedAccounts(),
  });
}
