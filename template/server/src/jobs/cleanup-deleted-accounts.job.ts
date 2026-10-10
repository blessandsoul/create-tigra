/**
 * Cleanup Deleted Accounts Job
 *
 * Permanently purges soft-deleted user accounts after a 30-day retention period.
 * Hard-deletes the user record (cascades to refresh tokens and sessions; IP
 * blocks the user created as an admin are kept, with blockedBy set to NULL),
 * then deletes all of the user's media from disk (public AND private tier).
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
      // Hard delete user record first (cascades to RefreshToken + Session).
      // DB deletion is the critical operation — if it succeeds but file cleanup
      // fails, we only have orphaned files (harmless, cleanable later).
      // The reverse (files deleted, DB intact) would leave a dangling user record.
      await prisma.user.delete({
        where: { id: user.id },
      });

      // Delete all user media from disk (no-op if dirs don't exist)
      try {
        await fileStorageService.deleteUserMedia(user.id);
      } catch (fileError) {
        logger.warn(
          { err: fileError, userId: user.id },
          'User record purged but file cleanup failed — orphaned files may remain',
        );
      }

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
