// Initialize Sentry as early as possible — before the app (and its routes) are
// imported/built — so error capture is active before any request is handled.
// Inert no-op when SENTRY_DSN is unset. See src/libs/observability/sentry.ts.
import { initSentry } from '@libs/observability/sentry.js';
initSentry();

import { env } from '@config/env.js';
import { logger } from '@libs/logger.js';
import { testDatabaseConnection, disconnectPrisma } from '@libs/prisma.js';
import { connectRedis, disconnectRedis, waitForRedisReady } from '@libs/redis.js';
import { createShutdown } from '@libs/shutdown.js';
import { buildApp } from './app.js';

/** How long a production start waits for Redis before refusing (see start()). */
const REDIS_BOOT_WAIT_MS = 10_000;

async function start(): Promise<void> {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  // One shutdown for every way the process ends: exit 0 after a signal, 1 after
  // a crash or a failed start, 1 if closing takes longer than 8 s (see libs/shutdown.ts).
  const shutdown = createShutdown({
    close: async () => {
      if (app) {
        await app.close();
      }
      await disconnectRedis();
      await disconnectPrisma();
    },
    exit: (code) => process.exit(code),
    logger,
  });

  // Register signal handlers early
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, '[SERVER] Uncaught exception');
    void shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    // { err } even for a non-Error reason: pino would read a bare string as the message.
    logger.fatal({ err: reason }, '[SERVER] Unhandled rejection');
    void shutdown('unhandledRejection');
  });

  try {
    // The database check is only logged here: the Docker CMD already ran
    // `prisma migrate deploy`, which fails the start when the database cannot
    // be reached.
    await testDatabaseConnection();

    // Redis at boot. In production an unreachable Redis stops the start (exit
    // 1): it is almost always a wrong REDIS_URL, and the app would otherwise
    // run with rate limits, login lockout and IP blocks silently off. On
    // Coolify the failed container never becomes healthy, so a rolling deploy
    // keeps the old one serving. It may be just starting too (a server
    // reboot), hence the wait. After boot, outages stay non-fatal
    // (libs/redis.ts). Outside production the server starts without it.
    const redisReady = await connectRedis();
    if (env.NODE_ENV === 'production' && !redisReady) {
      logger.info(`[SERVER] Waiting up to ${REDIS_BOOT_WAIT_MS / 1000}s for Redis`);
      if (!(await waitForRedisReady(REDIS_BOOT_WAIT_MS))) {
        // Never the URL: it carries the password.
        logger.fatal(
          '[SERVER] Redis is not reachable at boot: production refuses to start without it ' +
            '(rate limits, login lockout and IP blocks would be off). Check REDIS_URL.',
        );
        await shutdown('startup-error');
        return;
      }
    }

    app = await buildApp();

    await app.listen({ port: env.PORT, host: env.HOST });
    logger.info(`[SERVER] Started on http://${env.HOST}:${env.PORT} [${env.NODE_ENV}]`);
  } catch (error) {
    logger.fatal({ err: error }, '[SERVER] Failed to start');
    await shutdown('startup-error');
  }
}

// start() handles its own failures (it logs them and exits 1 through shutdown),
// so nothing waits on its promise.
void start();
