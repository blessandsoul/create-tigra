import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@libs/prisma.js';
import { clearAuthCookies } from '@libs/cookies.js';
import { authenticate, authorize } from '../auth.js';

// authenticate() is the single per-request gate: it must take the role from
// the database (not the token) and refuse banned accounts.

vi.mock('@libs/prisma.js', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));
vi.mock('@libs/cookies.js', () => ({ clearAuthCookies: vi.fn() }));

type DbUser = {
  isActive: boolean;
  emailVerifiedAt: Date | null;
  deletedAt: Date | null;
  role: 'USER' | 'ADMIN';
};

function makeRequest(tokenRole: 'USER' | 'ADMIN'): FastifyRequest {
  const request = {
    user: { userId: 'user-1', role: tokenRole },
    jwtVerify: vi.fn().mockResolvedValue(undefined),
  };
  return request as unknown as FastifyRequest;
}

const reply = {} as FastifyReply;

function mockDbUser(user: DbUser | null): void {
  vi.mocked(prisma.user.findUnique).mockResolvedValue(user as never);
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
});
