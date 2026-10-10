import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@libs/prisma.js';
import { fileStorageService } from '@libs/storage/file-storage.service.js';
import { purgeDeletedAccounts } from '../cleanup-deleted-accounts.job.js';

// The purge must complete for every account past retention: one failing
// account is logged and skipped, never blocks the rest, and files are only
// removed after the database row is really gone.

vi.mock('@libs/prisma.js', () => ({
  prisma: { user: { findMany: vi.fn(), delete: vi.fn() } },
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
    // Media is removed only for accounts whose row was really deleted
    expect(fileStorageService.deleteUserMedia).toHaveBeenCalledTimes(2);
    expect(fileStorageService.deleteUserMedia).not.toHaveBeenCalledWith('b');
  });

  it('counts an account as purged even if its file cleanup fails', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: 'a' }] as never);
    vi.mocked(prisma.user.delete).mockResolvedValue({} as never);
    vi.mocked(fileStorageService.deleteUserMedia).mockRejectedValue(new Error('disk'));

    await expect(purgeDeletedAccounts()).resolves.toEqual({ found: 1, purged: 1, failed: 0 });
  });
});
