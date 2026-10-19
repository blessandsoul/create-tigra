/**
 * "Sign out everywhere except here" (an owner's password change): the session
 * and refresh-token deletes keep exactly the asking session. Tokens without a
 * session always go: SQL `sessionId <> x` alone would skip NULL rows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@libs/prisma.js';
import { sessionRepository } from '../session.repo.js';
import { deleteRefreshTokensByUserId } from '../auth.repo.js';

vi.mock('@libs/prisma.js', () => ({
  prisma: { session: { deleteMany: vi.fn() }, refreshToken: { deleteMany: vi.fn() } },
  isPrismaNotFound: (): boolean => false,
  isPrismaWriteConflict: (): boolean => false,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.session.deleteMany).mockResolvedValue({ count: 2 });
});

describe('keeping one session', () => {
  it('deleteOtherUserSessions deletes every session of the user but the kept one', async () => {
    await expect(sessionRepository.deleteOtherUserSessions('u1', 's-keep')).resolves.toBe(2);
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', id: { not: 's-keep' } } });
  });

  it("deleteRefreshTokensByUserId with exceptSessionId keeps that session's tokens and deletes session-less ones", async () => {
    await deleteRefreshTokensByUserId('u1', { exceptSessionId: 's-keep' });
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', OR: [{ sessionId: null }, { sessionId: { not: 's-keep' } }] },
    });
  });

  it('deleteRefreshTokensByUserId without options still deletes all of them', async () => {
    await deleteRefreshTokensByUserId('u1');
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });
});
