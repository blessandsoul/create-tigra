import { PrismaClient } from '@prisma/client';
import { logger } from '@libs/logger.js';
import { env } from '@config/env.js';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Note: Connection pool size is configured via DATABASE_URL query params
    // Example: DATABASE_URL="mysql://...?connection_limit=50&pool_timeout=10"
    log:
      env.NODE_ENV === 'development'
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'stdout', level: 'warn' },
            { emit: 'stdout', level: 'error' },
          ]
        : [
            { emit: 'stdout', level: 'error' },
            // Log slow queries in production (queries taking > 2000ms)
            { emit: 'event', level: 'query' },
          ],
    // Note: Connection pool size is configured via DATABASE_URL query params
    // Example: DATABASE_URL="mysql://...?connection_limit=50&pool_timeout=10"
  });

// Log slow queries in production (queries taking > 2000ms)
if (env.NODE_ENV === 'production') {
  prisma.$on('query' as never, (e: { duration: number; query: string }) => {
    if (e.duration > 2000) {
      logger.warn(
        { duration: e.duration, query: e.query },
        `Slow query detected: ${e.duration}ms`,
      );
    }
  });
}

// Log all queries in development for debugging
if (env.NODE_ENV === 'development') {
  prisma.$on('query' as never, (e: { duration: number; query: string }) => {
    logger.debug({ duration: e.duration, query: e.query }, 'Database query');
  });
}

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export async function testDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('[DATABASE] Connection established');
    return true;
  } catch (error) {
    logger.warn('[DATABASE] Connection failed — server will start without DB');
    logger.debug(error);
    return false;
  }
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  logger.info('[DATABASE] Disconnected');
}
