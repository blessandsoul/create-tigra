import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRedis } from '@libs/redis.js';
import { getIpBlock, recordRateLimitViolation } from '../ip-block.js';

// Self-contained env so ip-block.ts can read its threshold constants at import
// time without loading/validating the real environment.
vi.mock('@config/env.js', () => ({
  env: {
    IP_AUTO_BLOCK_THRESHOLD: 20,
    IP_AUTO_BLOCK_WINDOW_SECONDS: 300,
    IP_AUTO_BLOCK_DURATION_SECONDS: 3600,
  },
}));

vi.mock('@libs/prisma.js', () => ({
  prisma: {
    blockedIp: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('@libs/redis.js');
vi.mock('@libs/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const redisMock = {
  del: vi.fn(),
  zadd: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
  sismember: vi.fn(),
  zscore: vi.fn(),
  zrem: vi.fn(),
};

describe('recordRateLimitViolation — infra-IP guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRedis).mockReturnValue(redisMock as never);
  });

  it('never auto-blocks a private/reserved IP (skips Redis accounting entirely)', async () => {
    // A shared Traefik/Docker internal IP must never be auto-banned — that would
    // lock out every real user behind it.
    await recordRateLimitViolation('10.0.0.5');
    expect(redisMock.incr).not.toHaveBeenCalled();
    expect(redisMock.zadd).not.toHaveBeenCalled();
  });

  it('skips loopback addresses', async () => {
    await recordRateLimitViolation('127.0.0.1');
    expect(redisMock.incr).not.toHaveBeenCalled();
  });

  it('records a violation for a public client IP', async () => {
    redisMock.incr.mockResolvedValue(1);
    await recordRateLimitViolation('93.184.216.34');
    expect(redisMock.incr).toHaveBeenCalledTimes(1);
  });
});

describe('getIpBlock — block state with the time left', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRedis).mockReturnValue(redisMock as never);
    redisMock.sismember.mockResolvedValue(0);
    redisMock.zscore.mockResolvedValue(null);
  });

  it('reports a permanent (admin) block without an end time', async () => {
    redisMock.sismember.mockResolvedValue(1);
    expect(await getIpBlock('93.184.216.34')).toEqual({ blocked: true, permanent: true });
  });

  it('reports an automatic block with the whole seconds until it ends', async () => {
    redisMock.zscore.mockResolvedValue(String(Date.now() / 1000 + 1799.2));
    expect(await getIpBlock('93.184.216.34')).toEqual({ blocked: true, permanent: false, retryAfterSeconds: 1800 });
  });

  it('cleans up an expired automatic block and reports no block', async () => {
    redisMock.zscore.mockResolvedValue(String(Date.now() / 1000 - 5));
    expect(await getIpBlock('93.184.216.34')).toEqual({ blocked: false });
    expect(redisMock.zrem).toHaveBeenCalledWith('auto_blocked_ips', '93.184.216.34');
  });

  it('fails open when Redis is down', async () => {
    redisMock.sismember.mockRejectedValue(new Error('down'));
    expect(await getIpBlock('93.184.216.34')).toEqual({ blocked: false });
  });
});
