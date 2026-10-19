import { getHeapStatistics } from 'node:v8';
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
  /** When the database and Redis were last actually checked (the answer can be up to 5 s old). */
  checkedAt: string;
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
      // No pool details: the pool is sized by connection_limit inside DATABASE_URL, which
      // this public endpoint must not echo.
    };
  } catch (error) {
    const responseTime = Date.now() - start;
    logger.error({ err: error }, 'Database health check failed');
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
    logger.warn({ err: error }, 'Redis health check failed');
    return {
      status: 'down',
      message: 'Redis connection failed (non-fatal)',
      responseTime,
    };
  }
}

/**
 * How long one database + Redis check answers every probe (/health,
 * /admin/health, /ready). The probes are public and unlimited (MONITORING_PATHS),
 * so without this each request would run a query: a flood of /health calls
 * would become a flood of database work. 5 s is far below any monitor's
 * interval, so an outage still shows within one probe.
 */
export const DEPENDENCY_CHECK_TTL_MS = 5_000;

interface DependencyChecks {
  database: CheckStatus;
  redis: CheckStatus;
  checkedAt: number;
}

let cachedChecks: DependencyChecks | null = null;
let checksInFlight: Promise<DependencyChecks> | null = null;

/**
 * The database and Redis checks, cached for DEPENDENCY_CHECK_TTL_MS and
 * single-flight: callers arriving while a check runs share its promise
 * instead of starting another (a hung database would otherwise collect one
 * pending query per probe). Failures are cached too, so a down database is
 * not retried by every probe. checkDatabase/checkRedis never throw.
 */
function checkDependencies(): Promise<DependencyChecks> {
  if (cachedChecks && Date.now() - cachedChecks.checkedAt < DEPENDENCY_CHECK_TTL_MS) {
    return Promise.resolve(cachedChecks);
  }
  if (!checksInFlight) {
    checksInFlight = Promise.all([checkDatabase(), checkRedis()])
      .then(([database, redis]) => {
        cachedChecks = { database, redis, checkedAt: Date.now() };
        return cachedChecks;
      })
      .finally(() => {
        checksInFlight = null;
      });
  }
  return checksInFlight;
}

/** Forget the cached checks, so each test starts with a real check. */
export function resetHealthCacheForTests(): void {
  cachedChecks = null;
  checksInFlight = null;
}

/** Heap use above this share of the heap LIMIT counts as degraded. */
export const HEAP_DEGRADED_RATIO = 0.85;

/**
 * Check memory usage against the heap LIMIT (v8 heap_size_limit), the point
 * where the process would crash with "heap out of memory".
 *
 * Not against heapTotal: V8 grows heapTotal just ahead of use, so
 * heapUsed/heapTotal sits at 70-99% in a perfectly healthy process (a fresh
 * one already reads 72%), and the old rule reported "degraded" constantly.
 * RSS is reported too: it is what the container's memory limit sees.
 */
export function checkMemory(
  heap: { used_heap_size: number; heap_size_limit: number } = getHeapStatistics(),
  usage: { rss: number; external: number } = process.memoryUsage(),
): CheckStatus {
  const mb = (bytes: number): number => Math.round(bytes / 1024 / 1024);
  const ratio = heap.heap_size_limit > 0 ? heap.used_heap_size / heap.heap_size_limit : 0;
  const heapUsagePercent = Math.round(ratio * 100);
  const status = ratio > HEAP_DEGRADED_RATIO ? 'degraded' : 'up';

  return {
    status,
    message:
      status === 'degraded'
        ? `High memory usage: ${heapUsagePercent}% of the heap limit`
        : `Memory usage normal: ${heapUsagePercent}% of the heap limit`,
    details: {
      heapUsedMB: mb(heap.used_heap_size),
      heapLimitMB: mb(heap.heap_size_limit),
      heapUsagePercent,
      rssMB: mb(usage.rss),
      externalMB: mb(usage.external),
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
 * Full health report. Database and Redis come from the shared 5 s cache
 * (checkDependencies); memory and uptime are read fresh, they cost nothing.
 */
export async function performHealthCheck(): Promise<HealthCheckResult> {
  const { database, redis, checkedAt } = await checkDependencies();
  const memory = checkMemory();
  const uptime = checkUptime();

  // Determine overall status
  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (database.status === 'down') {
    status = 'unhealthy'; // Critical: DB is required
  } else if (
    database.status === 'degraded' ||
    // Redis down is non-fatal (the app keeps serving and reconnects on its
    // own), but rate limits, IP blocks and login lockout are off meanwhile, so
    // monitoring must see it instead of a green "healthy".
    redis.status !== 'up' ||
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
    checkedAt: new Date(checkedAt).toISOString(),
    version: '1.0.0',
    environment: env.NODE_ENV,
  };
}

/**
 * Readiness (for load balancers): ready while the database answers, slow or
 * not. Shares the cached check with /health, so it adds no query of its own.
 */
export async function checkReadiness(): Promise<boolean> {
  const { database } = await checkDependencies();
  return database.status !== 'down';
}

/**
 * Simple liveness check (for container orchestration)
 */
export function checkLiveness(): boolean {
  // Server is alive if this function executes
  return true;
}
