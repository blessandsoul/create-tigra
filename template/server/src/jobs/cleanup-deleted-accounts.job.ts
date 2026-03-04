/**
 * Cleanup Deleted Accounts Job
 *
 * Permanently purges soft-deleted user accounts after a 30-day retention period.
 * Deletes avatar files from disk and hard-deletes the user record (cascades to
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
          avatarUrl: true,
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
          // Delete avatar files from disk if they exist
          if (user.avatarUrl) {
            await fileStorageService.deleteAvatar(user.id);
          }

          // Hard delete user record (cascades to RefreshToken + Session)
          await prisma.user.delete({
            where: { id: user.id },
          });

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
