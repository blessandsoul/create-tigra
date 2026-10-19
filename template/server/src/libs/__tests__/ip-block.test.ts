import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRedis } from '@libs/redis.js';
import { prisma } from '@libs/prisma.js';
import { blockIp, getIpBlock, pruneExpiredAutoBlocks, recordRateLimitViolation, unblockIp } from '../ip-block.js';

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
  isPrismaUniqueViolation: (e: unknown): boolean => (e as { code?: string })?.code === 'P2002',
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
  sadd: vi.fn(),
  srem: vi.fn(),
  zremrangebyscore: vi.fn(),
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

// Admin blocks: stored and matched in the one canonical spelling (the visitor
// key uses the same), and an admin can never lock themselves or everyone out.
describe('blockIp / unblockIp — one spelling, no self-lockout', () => {
  const ADMIN_IP = '198.51.100.9';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRedis).mockReturnValue(redisMock as never);
    vi.mocked(prisma.blockedIp.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.blockedIp.create).mockImplementation((async ({ data }: { data: { ip: string } }) => ({
      id: 'b1', ip: data.ip, reason: null, blockedBy: 'admin-1', createdAt: new Date(),
    })) as never);
  });

  it('stores any spelling of an address in its canonical form, in the DB and in Redis', async () => {
    const blocked = await blockIp('2001:0DB8:0000::0001', 'admin-1', undefined, ADMIN_IP);
    expect(blocked.ip).toBe('2001:db8::1');
    expect(redisMock.sadd).toHaveBeenCalledWith('blocked_ips', '2001:db8::1');

    await blockIp('::ffff:203.0.113.7', 'admin-1', undefined, ADMIN_IP);
    expect(vi.mocked(prisma.blockedIp.create).mock.calls[1]?.[0]).toMatchObject({ data: { ip: '203.0.113.7' } });
  });

  it("refuses the admin's own address, however it is written", async () => {
    await expect(blockIp(`::ffff:${ADMIN_IP}`, 'admin-1', undefined, ADMIN_IP)).rejects.toMatchObject({
      statusCode: 422,
      code: 'CANNOT_BLOCK_OWN_IP',
    });
    expect(prisma.blockedIp.create).not.toHaveBeenCalled();
  });

  it.each(['10.0.0.5', '192.168.1.1', '127.0.0.1', '::1'])('refuses the private/reserved address %s', async (ip) => {
    await expect(blockIp(ip, 'admin-1', undefined, ADMIN_IP)).rejects.toMatchObject({
      statusCode: 422,
      code: 'IP_NOT_BLOCKABLE',
    });
  });

  it('answers 409 for an address already blocked, and for a parallel duplicate insert', async () => {
    vi.mocked(prisma.blockedIp.findUnique).mockResolvedValueOnce({ id: 'b0' } as never);
    await expect(blockIp('203.0.113.7', 'admin-1', undefined, ADMIN_IP)).rejects.toMatchObject({
      statusCode: 409,
      code: 'IP_ALREADY_BLOCKED',
    });

    vi.mocked(prisma.blockedIp.create).mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(blockIp('203.0.113.8', 'admin-1', undefined, ADMIN_IP)).rejects.toMatchObject({
      statusCode: 409,
      code: 'IP_ALREADY_BLOCKED',
    });
  });

  it('unblocks by the canonical form, in the DB and both Redis lists', async () => {
    await unblockIp('2001:DB8::1');
    expect(prisma.blockedIp.deleteMany).toHaveBeenCalledWith({ where: { ip: '2001:db8::1' } });
    expect(redisMock.srem).toHaveBeenCalledWith('blocked_ips', '2001:db8::1');
    expect(redisMock.zrem).toHaveBeenCalledWith('auto_blocked_ips', '2001:db8::1');
  });
});

describe('pruneExpiredAutoBlocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRedis).mockReturnValue(redisMock as never);
  });

  it('removes every automatic block whose end time has passed, and says how many', async () => {
    redisMock.zremrangebyscore.mockResolvedValue(3);
    await expect(pruneExpiredAutoBlocks(1_700_000_000)).resolves.toBe(3);
    expect(redisMock.zremrangebyscore).toHaveBeenCalledWith('auto_blocked_ips', '-inf', 1_700_000_000);
  });

  it('does nothing and reports 0 when Redis is down (fail-open)', async () => {
    redisMock.zremrangebyscore.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(pruneExpiredAutoBlocks()).resolves.toBe(0);
  });
});

