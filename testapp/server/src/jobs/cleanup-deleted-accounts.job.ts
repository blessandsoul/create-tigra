/**
 * Cleanup Deleted Accounts Job
 *
 * Permanently purges soft-deleted user accounts after a 30-day retention period.
 * Deletes all user media from disk and hard-deletes the user record (cascades to
 * refresh tokens and sessions via onDelete: Cascade).
 *
 * Runs once daily.
 */

import type { FastifyInstance } from 'fastify';
import { prisma } from '@libs/prisma.js';
import { logger } from '@libs/logger.js';
import { fileStorageService } from '@libs/storage/file-storage.service.js';

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RETENTION_DAYS = 30;

export function startCleanupDeletedAccountsJob(app: FastifyInstance): void {
  const intervalId = setInterval(async () => {
    try {
      const cutoffDate = new Date();
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

      if (usersToDelete.length === 0) {
        return;
      }

      logger.info(
        { count: usersToDelete.length },
        'Starting purge of soft-deleted accounts',
      );

      let purgedCount = 0;

      for (const user of usersToDelete) {
        try {
          // Hard delete user record first (cascades to RefreshToken + Session).
          // DB deletion is the critical operation — if it succeeds but file cleanup
          // fails, we only have orphaned files (harmless, cleanable later).
          // The reverse (files deleted, DB intact) would leave a dangling user record.
          await prisma.user.delete({
            where: { id: user.id },
          });

          // Delete all user media from disk (no-op if dir doesn't exist)
          try {
            await fileStorageService.deleteUserMedia(user.id);
          } catch (fileError) {
            logger.warn(
              { err: fileError, userId: user.id },
              'User record purged but file cleanup failed - orphaned files may remain',
            );
          }

          purgedCount++;
        } catch (error) {
          logger.error(
            { err: error, userId: user.id },
            'Failed to purge deleted account',
          );
        }
      }

      logger.info(
        { purgedCount, totalFound: usersToDelete.length },
        'Deleted accounts purge complete',
      );
    } catch (error) {
      logger.error({ err: error }, 'Failed to run deleted accounts cleanup');
    }
  }, INTERVAL_MS);

  app.addHook('onClose', async () => {
    clearInterval(intervalId);
  });
}
