/**
 * The background jobs' work against a real MySQL and Redis (the layer 6
 * guarantees). Their timing (first run about a minute after every start,
 * then on the interval) is covered by schedule.test.ts; here each job runs
 * once, directly, on data made for it.
 * - The purge removes accounts deleted more than 30 days ago and keeps the
 *   recent ones; two purges at once (two server processes) both succeed.
 * - The auth cleanup removes expired sessions and refresh tokens, keeps live
 *   ones, and prunes expired automatic IP blocks while keeping running ones.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, buildTestApp, call, db, redis, registerUser, signIn } from '@/test/integration-helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app?.close();
});

const DAY_MS = 86_400_000;

/** A registered, then self-deleted account, its deletion moved `daysAgo` back. */
async function deletedAccount(tag: string, daysAgo: number): Promise<string> {
  const u = await registerUser(app, tag);
  expect((await call(app, 'DELETE', '/users/me', { jar: u.jar, payload: { password: PASSWORD } })).status).toBe(200);
  await (await db()).user.update({ where: { id: u.id }, data: { deletedAt: new Date(Date.now() - daysAgo * DAY_MS) } });
  return u.id;
}

describe('purge of deleted accounts', () => {
  it('removes the account deleted 31 days ago and keeps the one deleted just now', async () => {
    const old = await deletedAccount('purge-old', 31);
    const recent = await deletedAccount('purge-recent', 0);
    const { purgeDeletedAccounts } = await import('@jobs/cleanup-deleted-accounts.job.js');
    const result = await purgeDeletedAccounts();
    expect(result.failed).toBe(0);
    expect(await (await db()).user.count({ where: { id: old } })).toBe(0);
    const kept = await (await db()).user.findUnique({ where: { id: recent }, select: { deletedAt: true } });
    expect(kept).not.toBeNull();
    expect(kept?.deletedAt).not.toBeNull();
  });

  it('two purges at once (two server processes) both finish without a failure; every account is gone', async () => {
    // Several accounts, so the two runs work on the same rows at the same time.
    // Here both usually read a row before either deletes it, and the second
    // DELETE simply removes nothing. The other order (the row is gone before
    // the read, Prisma P2025) is pinned by cleanup-deleted-accounts.job.test.ts.
    const ids = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => deletedAccount(`purge-race-${i}`, 40)));
    const { purgeDeletedAccounts } = await import('@jobs/cleanup-deleted-accounts.job.js');
    const results = await Promise.all([purgeDeletedAccounts(), purgeDeletedAccounts()]);
    expect(results.map((r) => r.failed)).toEqual([0, 0]);
    expect(await (await db()).user.count({ where: { id: { in: ids } } })).toBe(0);
  });
});

describe('cleanup of expired auth records', () => {
  it('removes an expired session and its refresh token; the live session stays', async () => {
    const u = await registerUser(app, 'cleanup');
    await signIn(app, u.email); // a second session
    const prisma = await db();
    const [expired] = await prisma.session.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' }, take: 1 });
    const past = new Date(Date.now() - 3_600_000);
    await prisma.session.update({ where: { id: expired.id }, data: { expiresAt: past } });
    await prisma.refreshToken.updateMany({ where: { sessionId: expired.id }, data: { expiresAt: past } });

    const { cleanupExpiredAuth } = await import('@jobs/cleanup-expired-auth.job.js');
    await cleanupExpiredAuth();
    expect(await prisma.session.count({ where: { id: expired.id } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { sessionId: expired.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(1);
  });

  it('prunes an automatic IP block that ended and keeps one still running', async () => {
    const now = Math.floor(Date.now() / 1000);
    await (await redis()).zadd('auto_blocked_ips', now - 100, '203.0.113.201', now + 3600, '203.0.113.202');
    const { cleanupExpiredAuth } = await import('@jobs/cleanup-expired-auth.job.js');
    const result = await cleanupExpiredAuth();
    expect(result.autoBlocks).toBeGreaterThanOrEqual(1);
    expect(await (await redis()).zscore('auto_blocked_ips', '203.0.113.201')).toBeNull();
    expect(await (await redis()).zscore('auto_blocked_ips', '203.0.113.202')).not.toBeNull();
    await (await redis()).zrem('auto_blocked_ips', '203.0.113.202');
  });
});
