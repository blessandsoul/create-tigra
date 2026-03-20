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
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
          ]
        : [
            { emit: 'event', level: 'error' },
            // Log slow queries in production (queries taking > 2000ms)
            { emit: 'event', level: 'query' },
          ],
    // Note: Connection pool size is configured via DATABASE_URL query params
    // Example: DATABASE_URL="mysql://...?connection_limit=50&pool_timeout=10"
  });

// Track whether to suppress Prisma's internal error logs (during connection test)
let suppressPrismaErrors = false;

export function setSuppressPrismaErrors(value: boolean): void {
  suppressPrismaErrors = value;
}

// Route Prisma errors through our logger (suppressed during connection test)
prisma.$on('error' as never, (e: { message: string }) => {
  if (!suppressPrismaErrors) {
    logger.error({ prismaError: e.message }, '[DATABASE] Prisma error');
  }
});

// Route Prisma warnings through our logger
if (env.NODE_ENV === 'development') {
  prisma.$on('warn' as never, (e: { message: string }) => {
    logger.warn({ prismaWarning: e.message }, '[DATABASE] Prisma warning');
  });
}

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

/**
 * Check if a caught error is Prisma's "record not found" error (P2025).
 * Use in delete/update operations where the record may have already been
 * removed by a concurrent request or cleanup job.
 */
export function isPrismaNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code: string }).code === 'P2025'
  );
}

let dbConnected = false;

export function isDatabaseConnected(): boolean {
  return dbConnected;
}

export async function testDatabaseConnection(): Promise<boolean> {
  try {
    suppressPrismaErrors = true;
    await prisma.$queryRaw`SELECT 1`;
    dbConnected = true;
    logger.info('[DATABASE] Connection established');
    return true;
  } catch {
    logger.warn('[DATABASE] Connection failed - server will start without DB');
    return false;
  } finally {
    suppressPrismaErrors = false;
  }
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  logger.info('[DATABASE] Disconnected');
}
