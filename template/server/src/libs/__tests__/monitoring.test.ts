/**
 * Health checks (../monitoring.ts) with the database and Redis mocked: the
 * memory rule judges the heap LIMIT, not V8's current heap size, and a failing
 * check logs the real error.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
  monitoring.resetHealthCacheForTests();
  vi.useRealTimers();
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

describe('dependency check cache (5 s, single-flight)', () => {
  it('100 probes inside 5 s run one database query and one PING', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 100; i++) await monitoring.performHealthCheck();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('checks again once 5 s have passed', async () => {
    vi.useFakeTimers();
    await monitoring.performHealthCheck();
    vi.advanceTimersByTime(monitoring.DEPENDENCY_CHECK_TTL_MS - 1);
    await monitoring.performHealthCheck();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    const report = await monitoring.performHealthCheck();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(report.checkedAt).toBe(new Date(Date.now()).toISOString());
  });

  it('concurrent probes during a slow check share it instead of queueing more queries', async () => {
    let answer!: (rows: unknown) => void;
    vi.mocked(prisma.$queryRaw).mockReturnValue(new Promise((resolve) => (answer = resolve)) as never);
    const probes = Promise.all([
      ...Array.from({ length: 10 }, () => monitoring.performHealthCheck()),
      monitoring.checkReadiness(),
    ]);
    answer([{ 1: 1 }]);
    const results = await probes;
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(results.at(-1)).toBe(true);
  });

  it('/ready reuses the check /health just made, and a cached failure is not retried', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('down'));
    expect((await monitoring.performHealthCheck()).status).toBe('unhealthy');
    expect(await monitoring.checkReadiness()).toBe(false);
    expect((await monitoring.performHealthCheck()).status).toBe('unhealthy');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('a slow database is still ready (only down is not ready)', async () => {
    vi.useFakeTimers();
    vi.mocked(prisma.$queryRaw).mockImplementation((() => {
      vi.advanceTimersByTime(150);
      return Promise.resolve([{ 1: 1 }]);
    }) as never);
    expect(await monitoring.checkReadiness()).toBe(true);
    expect((await monitoring.performHealthCheck()).checks.database.status).toBe('degraded');
  });
});

describe('overall status rules', () => {
  /** Makes the mocked call take `ms` of fake time, so the 100 ms / 50 ms thresholds apply. */
  const takes = (ms: number, value: unknown) => (): Promise<unknown> => {
    vi.advanceTimersByTime(ms);
    return Promise.resolve(value);
  };

  it('all fast and memory normal: healthy, every check up', async () => {
    const report = await monitoring.performHealthCheck();
    expect(report.status).toBe('healthy');
    expect(Object.values(report.checks).map((c) => c.status)).toEqual(['up', 'up', 'up', 'up']);
  });

  it('a database at 100 ms or more: degraded, not unhealthy', async () => {
    vi.useFakeTimers();
    vi.mocked(prisma.$queryRaw).mockImplementation(takes(100, [{ 1: 1 }]) as never);
    const report = await monitoring.performHealthCheck();
    expect(report.checks.database).toMatchObject({ status: 'degraded', message: 'Database responding slowly' });
    expect(report.status).toBe('degraded');
  });

  it('Redis at 50 ms or more: degraded', async () => {
    vi.useFakeTimers();
    ping.mockImplementation(takes(50, 'PONG'));
    const report = await monitoring.performHealthCheck();
    expect(report.checks.redis).toMatchObject({ status: 'degraded', message: 'Redis responding slowly' });
    expect(report.status).toBe('degraded');
  });

  it('the database down wins over everything: unhealthy', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('down'));
    ping.mockRejectedValue(new Error('down'));
    expect((await monitoring.performHealthCheck()).status).toBe('unhealthy');
  });
});

describe('version and commit in the report', () => {
  it('readAppVersion reads package.json, else answers unknown', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tigra-version-'));
    try {
      expect(monitoring.readAppVersion(dir)).toBe('unknown'); // no package.json
      writeFileSync(path.join(dir, 'package.json'), '{ not json');
      expect(monitoring.readAppVersion(dir)).toBe('unknown');
      writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x' }));
      expect(monitoring.readAppVersion(dir)).toBe('unknown');
      writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.4.0' }));
      expect(monitoring.readAppVersion(dir)).toBe('2.4.0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('shortCommit keeps 12 characters, trims, and turns empty into null', () => {
    expect(monitoring.shortCommit('abc1234def5678901234')).toBe('abc1234def56');
    expect(monitoring.shortCommit('  abc1234  ')).toBe('abc1234');
    expect(monitoring.shortCommit('   ')).toBeNull();
    expect(monitoring.shortCommit(undefined)).toBeNull();
  });

  it('the report carries the server package version and a null commit when SOURCE_COMMIT is unset', async () => {
    const report = await monitoring.performHealthCheck();
    expect(report.version).toBe(monitoring.readAppVersion());
    expect(report.version).not.toBe('unknown');
    expect(report.commit).toBeNull();
  });
});
