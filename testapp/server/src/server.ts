import { env } from '@config/env.js';
import { logger } from '@libs/logger.js';
import { testDatabaseConnection, disconnectPrisma } from '@libs/prisma.js';
import { connectRedis, disconnectRedis } from '@libs/redis.js';
import { buildApp } from './app.js';

async function start(): Promise<void> {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;
  let isShuttingDown = false;

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return; // Prevent multiple shutdown attempts
    isShuttingDown = true;

    logger.info(`[SERVER] Received ${signal} — shutting down gracefully`);
    try {
      if (app) {
        await app.close();
      }
      await disconnectRedis();
      await disconnectPrisma();
      logger.info('[SERVER] Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error(error, '[SERVER] Error during shutdown');
      process.exit(1);
    }
  };

  // Register signal handlers early
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (error) => {
    logger.fatal(error, '[SERVER] Uncaught exception');
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal(reason, '[SERVER] Unhandled rejection');
    shutdown('unhandledRejection');
  });

  try {
    // Test external connections (non-fatal)
    await testDatabaseConnection();
    await connectRedis();

    app = await buildApp();

    await app.listen({ port: env.PORT, host: env.HOST });
    logger.info(`[SERVER] Started on http://${env.HOST}:${env.PORT} [${env.NODE_ENV}]`);
  } catch (error) {
    logger.fatal(error, '[SERVER] Failed to start');
    await shutdown('startup-error');
  }
}

start();
