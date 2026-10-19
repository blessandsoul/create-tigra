import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@libs/prisma.js';
import { fileStorageService } from '@libs/storage/file-storage.service.js';
import type { FastifyInstance } from 'fastify';
import { logger } from '@libs/logger.js';
import { purgeDeletedAccounts, startCleanupDeletedAccountsJob } from '../cleanup-deleted-accounts.job.js';

// The purge must complete for every account past retention: one failing
// account is logged and skipped, never blocks the rest. Files go first and the
// row last, so an account whose files could not be removed stays in the
// database and is retried by the next run.

vi.mock('@libs/prisma.js', () => ({
  prisma: { user: { findMany: vi.fn(), delete: vi.fn() } },
  isPrismaNotFound: (e: unknown): boolean => (e as { code?: string })?.code === 'P2025',
}));
vi.mock('@libs/storage/file-storage.service.js', () => ({
  fileStorageService: { deleteUserMedia: vi.fn() },
}));
vi.mock('@libs/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('purgeDeletedAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only selects accounts soft-deleted more than 30 days ago', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    const now = new Date('2026-03-31T12:00:00Z');

    const result = await purgeDeletedAccounts(now);

    const where = vi.mocked(prisma.user.findMany).mock.calls[0][0]?.where as {
      deletedAt: { not: null; lt: Date };
    };
    expect(where.deletedAt.lt.toISOString()).toBe('2026-03-01T12:00:00.000Z');
    expect(result).toEqual({ found: 0, purged: 0, failed: 0 });
  });

  it('keeps going when one account fails and reports the counts', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never);
    vi.mocked(prisma.user.delete).mockImplementation((({ where }: { where: { id: string } }) =>
      where.id === 'b' ? Promise.reject(new Error('fk constraint')) : Promise.resolve({})) as never);

    const result = await purgeDeletedAccounts();

    expect(result).toEqual({ found: 3, purged: 2, failed: 1 });
    expect(prisma.user.delete).toHaveBeenCalledTimes(3);
  });

  it('removes the files before the row', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: 'a' }] as never);
    vi.mocked(prisma.user.delete).mockResolvedValue({} as never);

    await purgeDeletedAccounts();

    const filesAt = vi.mocked(fileStorageService.deleteUserMedia).mock.invocationCallOrder[0];
    const rowAt = vi.mocked(prisma.user.delete).mock.invocationCallOrder[0];
    expect(filesAt).toBeLessThan(rowAt);
  });

  it('keeps the row when its files cannot be removed, so the next run retries', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: 'a' }, { id: 'b' }] as never);
    vi.mocked(prisma.user.delete).mockResolvedValue({} as never);
    vi.mocked(fileStorageService.deleteUserMedia).mockImplementation(async (id: string) => {
      if (id === 'a') throw new Error('disk');
    });

    await expect(purgeDeletedAccounts()).resolves.toEqual({ found: 2, purged: 1, failed: 1 });
    expect(prisma.user.delete).toHaveBeenCalledTimes(1);
    expect(prisma.user.delete).not.toHaveBeenCalledWith({ where: { id: 'a' } });
  });

  it('an account another process purged a moment ago counts as purged, without an error log', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: 'z' }] as never);
    vi.mocked(fileStorageService.deleteUserMedia).mockResolvedValue(undefined);
    vi.mocked(prisma.user.delete).mockRejectedValue(Object.assign(new Error('not found'), { code: 'P2025' }));

    await expect(purgeDeletedAccounts()).resolves.toEqual({ found: 1, purged: 1, failed: 0 });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs one line per run even when nothing was due (so the log shows it runs)', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    await purgeDeletedAccounts();
    expect(logger.info).toHaveBeenCalledWith(
      { purgedCount: 0, failedCount: 0, totalFound: 0 },
      'Deleted accounts purge complete',
    );
  });
});

describe('startCleanupDeletedAccountsJob', () => {
  it('runs about a minute after start, not a day later (a daily deploy used to postpone it forever)', async () => {
    vi.useFakeTimers();
    vi.clearAllMocks(); // this describe has no beforeEach of its own
    try {
      vi.mocked(prisma.user.findMany).mockResolvedValue([]);
      const app = { addHook: vi.fn() } as unknown as FastifyInstance;
      startCleanupDeletedAccountsJob(app);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

