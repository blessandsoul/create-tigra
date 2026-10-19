/**
 * The hourly auth cleanup: expired refresh tokens and sessions go from the
 * database, expired automatic IP blocks from Redis, and it first runs about a
 * minute after start.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@libs/prisma.js';
import { pruneExpiredAutoBlocks } from '@libs/ip-block.js';
import { cleanupExpiredAuth, startCleanupExpiredAuthJob } from '../cleanup-expired-auth.job.js';

vi.mock('@libs/prisma.js', () => ({
  prisma: { refreshToken: { deleteMany: vi.fn() }, session: { deleteMany: vi.fn() } },
}));
vi.mock('@libs/ip-block.js', () => ({ pruneExpiredAutoBlocks: vi.fn() }));
vi.mock('@libs/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValue({ count: 3 });
  vi.mocked(prisma.session.deleteMany).mockResolvedValue({ count: 2 });
  vi.mocked(pruneExpiredAutoBlocks).mockResolvedValue(4);
});

describe('cleanupExpiredAuth', () => {
  it('removes expired tokens and sessions, and prunes expired automatic IP blocks', async () => {
    const now = new Date('2026-10-19T12:00:00Z');
    await expect(cleanupExpiredAuth(now)).resolves.toEqual({ tokens: 3, sessions: 2, autoBlocks: 4 });
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: now } } });
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: now } } });
    expect(pruneExpiredAutoBlocks).toHaveBeenCalledWith(now.getTime() / 1000);
  });

  it('first runs about a minute after start', async () => {
    vi.useFakeTimers();
    try {
      startCleanupExpiredAuthJob({ addHook: vi.fn() } as unknown as FastifyInstance);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(prisma.session.deleteMany).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
