/**
 * Tokens at rest are fingerprints only (libs/token-hash.ts): refresh tokens in
 * MySQL, password-reset tokens in Redis. Callers keep passing the raw token;
 * nothing that is stored equals it, so reading the database or Redis yields no
 * usable login. (The email-verification module uses the same scheme.)
 */
import { createHash } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { hashToken } from '@libs/token-hash.js';
import { testUsers } from '@/test/setup.js';

const sha256 = (raw: string): string => createHash('sha256').update(raw).digest('hex');

const prismaMock = vi.hoisted(() => ({
  refreshToken: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  session: { update: vi.fn() },
  $transaction: vi.fn(),
}));
// rotateRefreshToken runs an interactive transaction: hand it the same mock as `tx`.
vi.mock('@libs/prisma.js', () => ({
  prisma: prismaMock,
  isPrismaNotFound: (): boolean => false,
  isPrismaWriteConflict: (e: unknown): boolean => (e as { code?: string })?.code === 'P2034',
}));

const redisMock = vi.hoisted(() => ({ status: 'ready', get: vi.fn(), set: vi.fn(), del: vi.fn(), getdel: vi.fn() }));
vi.mock('@libs/redis.js', () => ({ getRedis: (): typeof redisMock => redisMock }));

const sentEmails = vi.hoisted(() => [] as Array<{ html: string }>);
vi.mock('@libs/email.js', () => ({ sendEmail: vi.fn(async (msg: { html: string }) => void sentEmails.push(msg)) }));
vi.mock('@libs/email-quota.js', () => ({ consumeEmailQuota: vi.fn() }));
vi.mock('@libs/password.js', () => ({ hashPassword: vi.fn(async () => 'new-hash'), verifyPassword: vi.fn() }));
vi.mock('../session.repo.js', () => ({ sessionRepository: { deleteAllUserSessions: vi.fn() } }));

// Imported after the mocks.
const authRepo = await import('../auth.repo.js');
const authService = await import('../auth.service.js');

beforeEach(() => {
  vi.clearAllMocks();
  sentEmails.length = 0;
});

describe('hashToken', () => {
  it('is the SHA-256 hex of the token: 64 characters, deterministic, never the input', () => {
    expect(hashToken('abc')).toBe(sha256('abc'));
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('abc')).not.toBe('abc');
  });
});

describe('refresh tokens in MySQL', () => {
  const raw = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';

  it('stores only the fingerprint, and looks up and deletes by it', async () => {
    await authRepo.createRefreshToken({ token: raw, userId: 'u1', sessionId: 's1', expiresAt: new Date() });
    expect(prismaMock.refreshToken.create.mock.calls[0]?.[0].data.token).toBe(sha256(raw));

    await authRepo.findRefreshToken(raw);
    expect(prismaMock.refreshToken.findUnique).toHaveBeenCalledWith({ where: { token: sha256(raw) } });

    await authRepo.deleteRefreshToken(raw);
    expect(prismaMock.refreshToken.delete).toHaveBeenCalledWith({ where: { token: sha256(raw) } });
  });

  const newData = { token: 'new-raw', userId: 'u1', sessionId: 's1', expiresAt: new Date() };
  const runTx = (): void => {
    prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock));
  };

  it('rotation removes the old fingerprint with a counted delete and stores the new one', async () => {
    runTx();
    prismaMock.refreshToken.deleteMany.mockResolvedValue({ count: 1 });
    await expect(authRepo.rotateRefreshToken(raw, newData)).resolves.toBe(true);
    expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { token: sha256(raw) } });
    expect(prismaMock.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ token: sha256('new-raw') }),
    });
  });

  it('exactly one parallel rotation wins: the one that removed nothing creates nothing', async () => {
    runTx();
    prismaMock.refreshToken.deleteMany.mockResolvedValue({ count: 0 }); // a parallel refresh removed it
    await expect(authRepo.rotateRefreshToken(raw, newData)).resolves.toBe(false);
    expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    expect(prismaMock.session.update).not.toHaveBeenCalled();
  });

  it('a write conflict with the parallel transaction counts as a lost race, not a 500', async () => {
    prismaMock.$transaction.mockRejectedValue(Object.assign(new Error('write conflict'), { code: 'P2034' }));
    await expect(authRepo.rotateRefreshToken(raw, newData)).resolves.toBe(false);
  });
});

describe('password-reset tokens in Redis', () => {
  it('forgotPassword stores only the fingerprint; the raw token exists only in the email', async () => {
    vi.spyOn(authRepo, 'findUserByEmail').mockResolvedValue(testUsers.validUser);
    redisMock.get.mockResolvedValue(null);

    await authService.forgotPassword(testUsers.validUser.email);

    const raw = /token=([0-9a-f]{64})/.exec(sentEmails[0]?.html ?? '')?.[1];
    expect(raw).toBeDefined();
    const stored = JSON.stringify(redisMock.set.mock.calls);
    expect(stored).not.toContain(raw as string);
    expect(redisMock.set).toHaveBeenCalledWith(`pw-reset:${sha256(raw as string)}`, testUsers.validUser.id, 'EX', 3600);
    expect(redisMock.set).toHaveBeenCalledWith(`pw-reset-user:${testUsers.validUser.id}`, sha256(raw as string), 'EX', 3600);
  });

  it('resetPassword looks the emailed (raw) token up by its fingerprint', async () => {
    redisMock.getdel.mockResolvedValue(testUsers.validUser.id);
    vi.spyOn(authRepo, 'findUserById').mockResolvedValue(testUsers.validUser);
    vi.spyOn(authRepo, 'updateUserPassword').mockResolvedValue(undefined);
    vi.spyOn(authRepo, 'deleteRefreshTokensByUserId').mockResolvedValue(undefined);

    await authService.resetPassword('raw-reset-token', 'New-Passw0rd-123!');
    expect(redisMock.getdel).toHaveBeenCalledWith(`pw-reset:${sha256('raw-reset-token')}`);
  });
});
