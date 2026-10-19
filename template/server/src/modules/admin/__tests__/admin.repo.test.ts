/**
 * The admin repository queries behind the deleted-accounts list and restore:
 * the list shows live OR deleted accounts (never both), and restore changes
 * only a deleted row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@libs/prisma.js';
import { adminRepository } from '../admin.repo.js';

vi.mock('@libs/prisma.js', () => ({
  prisma: { user: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() } },
  isPrismaNotFound: (): boolean => false,
}));

const list = { page: 1, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' } as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.findMany).mockResolvedValue([]);
  vi.mocked(prisma.user.count).mockResolvedValue(0);
});

describe('adminRepository', () => {
  it('lists only live accounts by default', async () => {
    await adminRepository.getUsers(list);
    expect(vi.mocked(prisma.user.findMany).mock.calls[0]?.[0]?.where).toMatchObject({ deletedAt: null });
  });

  it('lists only soft-deleted accounts with deleted: true', async () => {
    await adminRepository.getUsers({ ...list, deleted: true });
    expect(vi.mocked(prisma.user.findMany).mock.calls[0]?.[0]?.where).toMatchObject({ deletedAt: { not: null } });
  });

  it('restore is one conditional update that touches only a deleted row', async () => {
    vi.mocked(prisma.user.updateMany).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(adminRepository.restoreUser('u1')).resolves.toBe(true);
    await expect(adminRepository.restoreUser('u1')).resolves.toBe(false);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', deletedAt: { not: null } },
      data: { deletedAt: null, isActive: true },
    });
  });
});
