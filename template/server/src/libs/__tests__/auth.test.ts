import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@libs/prisma.js';
import { clearAuthCookies } from '@libs/cookies.js';
import { authenticate, authorize, resolveMe, resolveTargetUser } from '../auth.js';

// authenticate() is the single per-request gate: the token must belong to a
// live session of this user, the role comes from the database (not the token),
// and banned or deleted accounts are refused.

vi.mock('@libs/prisma.js', () => ({
  prisma: { session: { findFirst: vi.fn() }, user: { findUnique: vi.fn() } },
}));
vi.mock('@libs/cookies.js', () => ({ clearAuthCookies: vi.fn() }));

type DbUser = {
  isActive: boolean;
  emailVerifiedAt: Date | null;
  deletedAt: Date | null;
  role: 'USER' | 'ADMIN';
};

/** `sessionId: null` builds a token without one (signed before tokens carried it). */
function makeRequest(tokenRole: 'USER' | 'ADMIN', sessionId: string | null = 'session-1'): FastifyRequest {
  const request = {
    user: { userId: 'user-1', role: tokenRole, ...(sessionId === null ? {} : { sessionId }) },
    jwtVerify: vi.fn().mockResolvedValue(undefined),
  };
  return request as unknown as FastifyRequest;
}

const reply = {} as FastifyReply;

/** The live session found for the token, carrying its user's current state. */
function mockDbUser(user: DbUser | null): void {
  vi.mocked(prisma.session.findFirst).mockResolvedValue({ user } as never);
}

describe('authenticate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replaces a stale ADMIN role from the token with the current database role', async () => {
    // The admin was demoted after this token was signed.
    mockDbUser({ isActive: true, emailVerifiedAt: new Date(), deletedAt: null, role: 'USER' });
    const request = makeRequest('ADMIN');

    await authenticate(request, reply);

    expect(request.user.role).toBe('USER');
    await expect(authorize('ADMIN')(request, reply)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('keeps admin access for a current admin', async () => {
    mockDbUser({ isActive: true, emailVerifiedAt: new Date(), deletedAt: null, role: 'ADMIN' });
    const request = makeRequest('ADMIN');

    await authenticate(request, reply);

    await expect(authorize('ADMIN')(request, reply)).resolves.toBeUndefined();
  });

  it('rejects a banned account with ACCOUNT_DEACTIVATED and clears its cookies', async () => {
    mockDbUser({ isActive: false, emailVerifiedAt: new Date(), deletedAt: null, role: 'USER' });

    await expect(authenticate(makeRequest('USER'), reply)).rejects.toMatchObject({
      statusCode: 403,
      code: 'ACCOUNT_DEACTIVATED',
    });
    expect(clearAuthCookies).toHaveBeenCalledWith(reply);
  });

  it('rejects a deleted account with 401', async () => {
    mockDbUser({ isActive: false, emailVerifiedAt: null, deletedAt: new Date(), role: 'USER' });

    await expect(authenticate(makeRequest('USER'), reply)).rejects.toMatchObject({ statusCode: 401 });
    expect(clearAuthCookies).toHaveBeenCalledWith(reply);
  });

  it('looks the session up by id, user and expiry in one query', async () => {
    mockDbUser({ isActive: true, emailVerifiedAt: new Date(), deletedAt: null, role: 'USER' });
    await authenticate(makeRequest('USER'), reply);
    expect(prisma.session.findFirst).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.session.findFirst).mock.calls[0]?.[0]).toMatchObject({
      where: { id: 'session-1', userId: 'user-1', expiresAt: { gt: expect.any(Date) } },
    });
  });

  it('refuses a token whose session ended (logout, revoke, password reset) and clears its cookies', async () => {
    vi.mocked(prisma.session.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ isActive: true, emailVerifiedAt: new Date(), deletedAt: null } as never);
    await expect(authenticate(makeRequest('USER'), reply)).rejects.toMatchObject({
      statusCode: 401,
      code: 'SESSION_EXPIRED',
    });
    expect(clearAuthCookies).toHaveBeenCalledWith(reply);
  });

  it('refuses a token without a session id (signed before tokens carried one) without querying', async () => {
    await expect(authenticate(makeRequest('USER', null), reply)).rejects.toMatchObject({
      statusCode: 401,
      code: 'SESSION_EXPIRED',
    });
    expect(prisma.session.findFirst).not.toHaveBeenCalled();
    expect(clearAuthCookies).toHaveBeenCalledWith(reply);
  });

  it("a banned user's token (the ban deleted its sessions) still says ACCOUNT_DEACTIVATED", async () => {
    vi.mocked(prisma.session.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ isActive: false, emailVerifiedAt: new Date(), deletedAt: null } as never);
    await expect(authenticate(makeRequest('USER'), reply)).rejects.toMatchObject({
      statusCode: 403,
      code: 'ACCOUNT_DEACTIVATED',
    });
    expect(clearAuthCookies).toHaveBeenCalledWith(reply);
  });
});

// resolveMe / resolveTargetUser decide WHOSE account a /users route acts on.
// They are the whole ownership check for the /users/:userId routes (profile,
// password, account deletion, avatar): an owner acts on themselves, an admin on
// anyone, everyone else is refused before the handler runs.
describe('resolveMe and resolveTargetUser', () => {
  function guardRequest(userId: string, role: 'USER' | 'ADMIN', params: Record<string, string> = {}): FastifyRequest {
    return { user: { userId, role, sessionId: 'session-1' }, params } as unknown as FastifyRequest;
  }

  it('resolveMe targets the signed-in user, never as an admin action', async () => {
    const request = guardRequest('user-1', 'ADMIN');
    await resolveMe(request, reply);
    expect(request.targetUserId).toBe('user-1');
    expect(request.isAdminAction).toBe(false);
  });

  it('an owner acts on their own account', async () => {
    const request = guardRequest('user-1', 'USER', { userId: 'user-1' });
    await resolveTargetUser(request, reply);
    expect(request.targetUserId).toBe('user-1');
    expect(request.isAdminAction).toBe(false);
  });

  it("refuses a user acting on someone else's account with 403", async () => {
    const request = guardRequest('user-2', 'USER', { userId: 'user-1' });
    await expect(resolveTargetUser(request, reply)).rejects.toMatchObject({ statusCode: 403 });
    expect(request.targetUserId).toBeUndefined();
  });

  it("lets an admin act on another user's account, marked as an admin action", async () => {
    const request = guardRequest('admin-1', 'ADMIN', { userId: 'user-1' });
    await resolveTargetUser(request, reply);
    expect(request.targetUserId).toBe('user-1');
    expect(request.isAdminAction).toBe(true);
  });

  it('an admin on their own account takes the owner path (still needs their own password)', async () => {
    const request = guardRequest('admin-1', 'ADMIN', { userId: 'admin-1' });
    await resolveTargetUser(request, reply);
    expect(request.isAdminAction).toBe(false);
  });

  it('refuses a request without :userId with 400 MISSING_USER_ID', async () => {
    await expect(resolveTargetUser(guardRequest('user-1', 'USER'), reply)).rejects.toMatchObject({
      statusCode: 400,
      code: 'MISSING_USER_ID',
    });
  });
});
