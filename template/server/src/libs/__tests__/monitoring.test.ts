/**
 * Health checks (../monitoring.ts) with the database and Redis mocked: the
 * memory rule judges the heap LIMIT, not V8's current heap size, and a failing
 * check logs the real error.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@libs/prisma.js';
import { getRedis } from '@libs/redis.js';
import { logger } from '@libs/logger.js';

vi.mock('@libs/prisma.js', () => ({ prisma: { $queryRaw: vi.fn() } }));
vi.mock('@libs/redis.js', () => ({ getRedis: vi.fn() }));
vi.mock('@libs/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@config/env.js', () => ({ env: { NODE_ENV: 'test', REDIS_MAX_RETRIES: 3, REDIS_CONNECT_TIMEOUT: 10000 } }));

const monitoring = await import('../monitoring.js');
const MB = 1024 * 1024;
const ping = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }] as never);
  ping.mockResolvedValue('PONG');
  vi.mocked(getRedis).mockReturnValue({ ping } as never);
});

describe('checkMemory', () => {
  it('is up when heap use is far from the heap LIMIT, even with heapUsed ≈ heapTotal', () => {
    // 354 MB used of a 4 GB limit: the old heapUsed/heapTotal rule called this "99%".
    const result = monitoring.checkMemory({ used_heap_size: 354 * MB, heap_size_limit: 4096 * MB }, { rss: 400 * MB, external: 5 * MB });
    expect(result.status).toBe('up');
    expect(result.details).toEqual({ heapUsedMB: 354, heapLimitMB: 4096, heapUsagePercent: 9, rssMB: 400, externalMB: 5 });
  });

  it('is degraded above 85% of the heap limit', () => {
    expect(monitoring.checkMemory({ used_heap_size: 860 * MB, heap_size_limit: 1000 * MB }, { rss: 0, external: 0 }).status).toBe('degraded');
    expect(monitoring.checkMemory({ used_heap_size: 850 * MB, heap_size_limit: 1000 * MB }, { rss: 0, external: 0 }).status).toBe('up');
  });

  it('a real fresh process reads as up', () => {
    expect(monitoring.checkMemory().status).toBe('up');
  });
});

describe('failing checks log the real error', () => {
  it('a database failure is logged under err (pino serializes only err)', async () => {
    const failure = new Error("Can't reach database server");
    vi.mocked(prisma.$queryRaw).mockRejectedValue(failure);
    const report = await monitoring.performHealthCheck();
    expect(report.status).toBe('unhealthy');
    expect(logger.error).toHaveBeenCalledWith({ err: failure }, 'Database health check failed');
  });

  it('a Redis failure is logged under err and makes the status degraded', async () => {
    const failure = new Error('ECONNREFUSED');
    ping.mockRejectedValue(failure);
    const report = await monitoring.performHealthCheck();
    expect(report.status).toBe('degraded');
    expect(logger.warn).toHaveBeenCalledWith({ err: failure }, 'Redis health check failed');
  });
});
