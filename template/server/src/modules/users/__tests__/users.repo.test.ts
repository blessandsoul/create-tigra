/**
 * The two avatar-related queries in users.repo: soft delete clears the avatar
 * URL, and the avatar swap is a counted compare-and-swap that never touches a
 * deleted account.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@libs/prisma.js';
import { usersRepository } from '../users.repo.js';

vi.mock('@libs/prisma.js', () => ({
  prisma: { user: { update: vi.fn(), updateMany: vi.fn() } },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usersRepository', () => {
  it('softDeleteUser clears the avatar URL with the deletion', async () => {
    await usersRepository.softDeleteUser('u1');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { deletedAt: expect.any(Date), isActive: false, avatarUrl: null },
    });
  });

  it('swapAvatarUrl changes the URL only if it is still the expected one, and says whether it did', async () => {
    vi.mocked(prisma.user.updateMany).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(usersRepository.swapAvatarUrl('u1', '/old.webp', '/new.webp')).resolves.toBe(true);
    await expect(usersRepository.swapAvatarUrl('u1', null, '/new.webp')).resolves.toBe(false);
    expect(prisma.user.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'u1', deletedAt: null, avatarUrl: '/old.webp' },
      data: { avatarUrl: '/new.webp' },
    });
    expect(vi.mocked(prisma.user.updateMany).mock.calls[1]?.[0]?.where).toMatchObject({ avatarUrl: null });
  });
});
