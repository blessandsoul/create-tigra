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
 * Runs once daily. `purgeDeletedAccounts()` is exported so it can also be run
 * on demand (tests, an operator script) without waiting for the interval.
 */

import type { FastifyInstance } from 'fastify';
import { prisma } from '@libs/prisma.js';
import { logger } from '@libs/logger.js';
import { fileStorageService } from '@libs/storage/file-storage.service.js';

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RETENTION_DAYS = 30;

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
  if (usersToDelete.length === 0) {
    return result;
  }

  logger.info({ count: usersToDelete.length }, 'Starting purge of soft-deleted accounts');

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

  logger.info(
    { purgedCount: result.purged, failedCount: result.failed, totalFound: result.found },
    'Deleted accounts purge complete',
  );
  return result;
}

export function startCleanupDeletedAccountsJob(app: FastifyInstance): void {
  const intervalId = setInterval(async () => {
    try {
      await purgeDeletedAccounts();
    } catch (error) {
      logger.error({ err: error }, 'Failed to run deleted accounts cleanup');
    }
  }, INTERVAL_MS);

  app.addHook('onClose', async () => {
    clearInterval(intervalId);
  });
}
