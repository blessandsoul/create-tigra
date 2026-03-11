import { prisma } from '@libs/prisma.js';
import { getRedis } from '@libs/redis.js';
import { env } from '@config/env.js';
import { logger } from '@libs/logger.js';

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    database: CheckStatus;
    redis: CheckStatus;
    memory: CheckStatus;
    uptime: CheckStatus;
  };
  timestamp: string;
  version: string;
  environment: string;
}

export interface CheckStatus {
  status: 'up' | 'down' | 'degraded';
  message?: string;
  responseTime?: number;
  details?: Record<string, unknown>;
}

const startTime = Date.now();

/**
 * Check database connectivity and response time
 */
async function checkDatabase(): Promise<CheckStatus> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const responseTime = Date.now() - start;

    return {
      status: responseTime < 100 ? 'up' : 'degraded',
      message: responseTime < 100 ? 'Database is healthy' : 'Database responding slowly',
      responseTime,
      details: {
        poolMin: env.DATABASE_POOL_MIN,
        poolMax: env.DATABASE_POOL_MAX,
      },
    };
  } catch (error) {
    const responseTime = Date.now() - start;
    logger.error({ error }, 'Database health check failed');
    return {
      status: 'down',
      message: 'Database connection failed',
      responseTime,
    };
  }
}

/**
 * Check Redis connectivity and response time
 */
async function checkRedis(): Promise<CheckStatus> {
  const start = Date.now();
  try {
    const redis = getRedis();
    await redis.ping();
    const responseTime = Date.now() - start;

    return {
      status: responseTime < 50 ? 'up' : 'degraded',
      message: responseTime < 50 ? 'Redis is healthy' : 'Redis responding slowly',
      responseTime,
      details: {
        maxRetries: env.REDIS_MAX_RETRIES,
        connectTimeout: env.REDIS_CONNECT_TIMEOUT,
      },
    };
  } catch (error) {
    const responseTime = Date.now() - start;
    logger.warn({ error }, 'Redis health check failed');
    return {
      status: 'down',
      message: 'Redis connection failed (non-fatal)',
      responseTime,
    };
  }
}

/**
 * Check memory usage
 */
function checkMemory(): CheckStatus {
  const used = process.memoryUsage();
  const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
  const rssMB = Math.round(used.rss / 1024 / 1024);
  const heapUsagePercent = Math.round((used.heapUsed / used.heapTotal) * 100);

  // Warn if heap usage > 80%
  const status = heapUsagePercent > 80 ? 'degraded' : 'up';
  const message =
    status === 'degraded'
      ? `High memory usage: ${heapUsagePercent}%`
      : `Memory usage normal: ${heapUsagePercent}%`;

  return {
    status,
    message,
    details: {
      heapUsedMB,
      heapTotalMB,
      rssMB,
      heapUsagePercent,
      external: Math.round(used.external / 1024 / 1024),
    },
  };
}

/**
 * Check server uptime
 */
function checkUptime(): CheckStatus {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const uptimeMinutes = Math.floor(uptimeSeconds / 60);
  const uptimeHours = Math.floor(uptimeMinutes / 60);
  const uptimeDays = Math.floor(uptimeHours / 24);

  let uptimeFormatted: string;
  if (uptimeDays > 0) {
    uptimeFormatted = `${uptimeDays}d ${uptimeHours % 24}h`;
  } else if (uptimeHours > 0) {
    uptimeFormatted = `${uptimeHours}h ${uptimeMinutes % 60}m`;
  } else if (uptimeMinutes > 0) {
    uptimeFormatted = `${uptimeMinutes}m ${uptimeSeconds % 60}s`;
  } else {
    uptimeFormatted = `${uptimeSeconds}s`;
  }

  return {
    status: 'up',
    message: `Server running for ${uptimeFormatted}`,
    details: {
      uptimeSeconds,
      startTime: new Date(startTime).toISOString(),
    },
  };
}

/**
 * Perform comprehensive health check
 */
export async function performHealthCheck(): Promise<HealthCheckResult> {
  const [database, redis, memory, uptime] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkMemory(),
    checkUptime(),
  ]);

  // Determine overall status
  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (database.status === 'down') {
    status = 'unhealthy'; // Critical: DB is required
  } else if (
    database.status === 'degraded' ||
    redis.status === 'degraded' ||
    memory.status === 'degraded'
  ) {
    status = 'degraded';
  } else {
    status = 'healthy';
  }

  return {
    status,
    checks: {
      database,
      redis,
      memory,
      uptime,
    },
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: env.NODE_ENV,
  };
}

/**
 * Simple readiness check (for load balancers)
 */
export async function checkReadiness(): Promise<boolean> {
  try {
    // Only check database - critical dependency
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Simple liveness check (for container orchestration)
 */
export function checkLiveness(): boolean {
  // Server is alive if this function executes
  return true;
}
