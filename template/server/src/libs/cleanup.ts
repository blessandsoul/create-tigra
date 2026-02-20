import type { FastifyInstance } from 'fastify';
import { prisma } from '@libs/prisma.js';
import { logger } from '@libs/logger.js';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export async function registerCleanupJob(app: FastifyInstance): Promise<void> {
  const intervalId = setInterval(async () => {
    try {
      const now = new Date();

      const deletedTokens = await prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: now } },
      });

      const deletedSessions = await prisma.session.deleteMany({
        where: { expiresAt: { lt: now } },
      });

      if (deletedTokens.count > 0 || deletedSessions.count > 0) {
        logger.info(
          { deletedTokens: deletedTokens.count, deletedSessions: deletedSessions.count },
          'Expired auth records cleaned up',
        );
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to clean up expired auth records');
    }
  }, CLEANUP_INTERVAL_MS);

  // Clear interval on server shutdown
  app.addHook('onClose', async () => {
    clearInterval(intervalId);
  });
}
