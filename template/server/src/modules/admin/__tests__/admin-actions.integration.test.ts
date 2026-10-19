/**
 * Administration against a real MySQL and Redis: what must stay true about
 * admin powers (the layer 5 hardening).
 * - The first admin is made with `make-admin <email>` (no password anywhere):
 *   it refuses unknown, deleted and banned accounts and verifies the email.
 * - The last active admin cannot delete their own account; an admin cannot
 *   ban themselves or change their own role; demoting an admin ends their
 *   sessions.
 * - An admin cannot block their own address or a private one; IP blocks use
 *   one canonical spelling (so a block matches however the address is
 *   written), a double block is 409, and the block is enforced.
 * - Deleted accounts are listed with their purge date and can be restored
 *   within the 30 days; the purge removes the rest.
 *
 * The "last admin" tests run first and demote every other admin in this
 * shared test database (files run one after another, earlier files are done
 * with theirs).
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  PASSWORD,
  buildTestApp,
  call,
  db,
  image,
  makeAdmin,
  redis,
  registerAdmin,
  registerUser,
  signIn,
  uniqueEmail,
  uploadAvatar,
  type TestUser,
} from '@/test/integration-helpers.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');

let app: FastifyInstance;
let admin: TestUser;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app?.close();
});

const roleOf = async (id: string): Promise<{ role: string; verified: boolean } | null> => {
  const row = await (await db()).user.findUnique({ where: { id }, select: { role: true, emailVerifiedAt: true } });
  return row ? { role: row.role, verified: row.emailVerifiedAt !== null } : null;
};

describe('the last active admin', () => {
  it('cannot delete their own account (409 LAST_ADMIN, after the password check); with a second admin they can', async () => {
    const a = await registerAdmin(app, 'onlyadmin');
    await (await db()).user.updateMany({ where: { role: 'ADMIN', id: { not: a.id } }, data: { role: 'USER' } });

    const wrong = await call(app, 'DELETE', '/users/me', { jar: a.jar, payload: { password: 'Wrong-Passw0rd-1' } });
    expect([wrong.status, wrong.code]).toEqual([422, 'INVALID_PASSWORD']);
    const last = await call(app, 'DELETE', '/users/me', { jar: a.jar, payload: { password: PASSWORD } });
    expect([last.status, last.code]).toEqual([409, 'LAST_ADMIN']);
    expect((await (await db()).user.findUnique({ where: { id: a.id } }))?.deletedAt).toBeNull();

    const b = await registerAdmin(app, 'secondadmin');
    expect((await call(app, 'DELETE', '/users/me', { jar: a.jar, payload: { password: PASSWORD } })).status).toBe(200);
    const c = await registerAdmin(app, 'thirdadmin');
    expect((await call(app, 'DELETE', `/users/${c.id}`, { jar: b.jar })).status).toBe(200);
    admin = b;
  });
});

describe('make-admin', () => {
  /** Runs the real script (src/scripts/make-admin.ts) against this test database. */
  const makeAdminScript = (email: string): { code: number | null; out: string } => {
    const r = spawnSync(process.execPath, [tsxCli, 'src/scripts/make-admin.ts', email], {
      cwd: serverRoot,
      env: process.env,
      encoding: 'utf8',
      timeout: 60_000,
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it('promotes an existing account (email in any case), which works without signing in again; again → "already"', async () => {
    const u = await registerUser(app, 'promote');
    const r = makeAdminScript(u.email.toUpperCase());
    expect(r.code).toBe(0);
    expect(await roleOf(u.id)).toEqual({ role: 'ADMIN', verified: true });
    expect((await call(app, 'GET', '/admin/stats', { jar: u.jar })).status).toBe(200);
    const again = makeAdminScript(u.email);
    expect(again.code).toBe(0);
    expect(again.out).toMatch(/already an admin/);
  });

  it('refuses an unknown, a deleted and a banned account (exit 1, role unchanged); verifies an unverified one', async () => {
    const outputs: string[] = [];
    const unknown = makeAdminScript(uniqueEmail('nobody'));
    outputs.push(unknown.out);
    expect([unknown.code, /No account with that email/.test(unknown.out)]).toEqual([1, true]);

    const del = await registerUser(app, 'mkdeleted');
    await call(app, 'DELETE', '/users/me', { jar: del.jar, payload: { password: PASSWORD } });
    const delR = makeAdminScript(del.email);
    outputs.push(delR.out);
    expect([delR.code, /deleted/.test(delR.out), (await roleOf(del.id))?.role]).toEqual([1, true, 'USER']);

    const ban = await registerUser(app, 'mkbanned');
    await call(app, 'PATCH', `/admin/users/${ban.id}/status`, { jar: admin.jar, payload: { isActive: false } });
    const banR = makeAdminScript(ban.email);
    outputs.push(banR.out);
    expect([banR.code, /banned/.test(banR.out), (await roleOf(ban.id))?.role]).toEqual([1, true, 'USER']);

    const unv = await registerUser(app, 'mkunverified');
    await (await db()).user.update({ where: { id: unv.id }, data: { emailVerifiedAt: null } });
    const unvR = makeAdminScript(unv.email);
    outputs.push(unvR.out);
    expect(unvR.code).toBe(0);
    expect(await roleOf(unv.id)).toEqual({ role: 'ADMIN', verified: true });

    // The output never carries the database URL or a password.
    const all = outputs.join('\n');
    expect(all).not.toMatch(/mysql:\/\//i);
    expect(all).not.toContain(PASSWORD);
  });
});

describe('admins cannot act on themselves', () => {
  it('self-ban → 403 CANNOT_BAN_SELF and the admin still works; banning another user still works', async () => {
    const self = await call(app, 'PATCH', `/admin/users/${admin.id}/status`, { jar: admin.jar, payload: { isActive: false } });
    expect([self.status, self.code]).toEqual([403, 'CANNOT_BAN_SELF']);
    expect((await call(app, 'GET', '/admin/stats', { jar: admin.jar })).status).toBe(200);
    const v = await registerUser(app, 'banvictim');
    expect((await call(app, 'PATCH', `/admin/users/${v.id}/status`, { jar: admin.jar, payload: { isActive: false } })).status).toBe(200);
    const me = await call(app, 'GET', '/auth/me', { cookie: v.jar.header() });
    expect([me.status, me.code]).toEqual([403, 'ACCOUNT_DEACTIVATED']);
  });

  it('self role change → 403; demoting another admin ends their sessions', async () => {
    expect((await call(app, 'PATCH', `/admin/users/${admin.id}/role`, { jar: admin.jar, payload: { role: 'USER' } })).status).toBe(403);
    const other = await registerAdmin(app, 'demoted');
    const otherDevice = await signIn(app, other.email);
    expect((await call(app, 'PATCH', `/admin/users/${other.id}/role`, { jar: admin.jar, payload: { role: 'USER' } })).status).toBe(200);
    expect((await call(app, 'GET', '/auth/me', { cookie: otherDevice.header() })).status).toBe(401);
  });
});

describe('IP blocks', () => {
  const blocked = async (ip: string): Promise<boolean> => (await (await redis()).sismember('blocked_ips', ip)) === 1;

  it('your own address → 422 CANNOT_BLOCK_OWN_IP; private and reserved addresses → 422 IP_NOT_BLOCKABLE', async () => {
    const own = (await call(app, 'GET', '/admin/client-ip', { jar: admin.jar })).body?.data?.ip as string;
    const self = await call(app, 'POST', '/admin/blocked-ips', { jar: admin.jar, payload: { ip: own } });
    expect([self.status, self.code]).toEqual([422, 'CANNOT_BLOCK_OWN_IP']);
    for (const ip of ['10.0.0.5', '192.168.1.1', '::1']) {
      const r = await call(app, 'POST', '/admin/blocked-ips', { jar: admin.jar, payload: { ip } });
      expect([ip, r.status, r.code]).toEqual([ip, 422, 'IP_NOT_BLOCKABLE']);
    }
  });

  it('one canonical spelling: stored and in Redis as 2001:db8::1; another spelling → 409; mapped IPv4 → plain IPv4', async () => {
    const r = await call(app, 'POST', '/admin/blocked-ips', { jar: admin.jar, payload: { ip: '2001:0DB8:0000::0001' } });
    expect([r.status, r.body?.data?.ip]).toEqual([201, '2001:db8::1']);
    expect((await (await db()).blockedIp.findMany({ where: { ip: { startsWith: '2001:' } } })).map((b) => b.ip)).toContain('2001:db8::1');
    expect(await blocked('2001:db8::1')).toBe(true);
    const dup = await call(app, 'POST', '/admin/blocked-ips', { jar: admin.jar, payload: { ip: '2001:db8::1' } });
    expect([dup.status, dup.code]).toEqual([409, 'IP_ALREADY_BLOCKED']);
    const mapped = await call(app, 'POST', '/admin/blocked-ips', { jar: admin.jar, payload: { ip: '::ffff:203.0.113.7' } });
    expect([mapped.status, mapped.body?.data?.ip]).toEqual([201, '203.0.113.7']);

    const un = await call(app, 'DELETE', `/admin/blocked-ips/${encodeURIComponent('2001:DB8::1')}`, { jar: admin.jar });
    expect(un.status).toBe(200);
    expect(await (await db()).blockedIp.count({ where: { ip: '2001:db8::1' } })).toBe(0);
    expect(await blocked('2001:db8::1')).toBe(false);
    expect((await call(app, 'DELETE', '/admin/blocked-ips/not-an-ip', { jar: admin.jar })).status).toBe(422);
    await call(app, 'DELETE', '/admin/blocked-ips/203.0.113.7', { jar: admin.jar });
  });

  it('two identical blocks at once → one 201 and one 409, never 500', async () => {
    const both = await Promise.all([0, 1].map(() => call(app, 'POST', '/admin/blocked-ips', { jar: admin.jar, payload: { ip: '203.0.113.50' } })));
    expect(both.map((b) => b.status).sort()).toEqual([201, 409]);
    await call(app, 'DELETE', '/admin/blocked-ips/203.0.113.50', { jar: admin.jar });
  });

  it('a block typed one way stops the same address written another way (403 IP_BLOCKED); a neighbour is not blocked', async () => {
    await call(app, 'POST', '/admin/blocked-ips', { jar: admin.jar, payload: { ip: '2001:0db8::abcd' } });
    // app.inject comes from 127.0.0.1, a trusted proxy hop, so X-Forwarded-For is believed.
    const hit = await call(app, 'GET', '/auth/me', { headers: { 'x-forwarded-for': '2001:db8:0:0:0:0:0:abcd' } });
    expect([hit.status, hit.code]).toEqual([403, 'IP_BLOCKED']);
    const neighbour = await call(app, 'GET', '/auth/me', { headers: { 'x-forwarded-for': '2001:db8::abce' } });
    expect(neighbour.status).toBe(401);
    await call(app, 'DELETE', `/admin/blocked-ips/${encodeURIComponent('2001:db8::abcd')}`, { jar: admin.jar });
  });
});

describe('deleted accounts: list, restore, purge', () => {
  let x: TestUser;

  it('?deleted=true lists a deleted account with purgeAt = deletedAt + 30 days; the default list does not', async () => {
    x = await registerUser(app, 'restorable');
    await uploadAvatar(app, x.jar, await image('png'));
    await call(app, 'DELETE', '/users/me', { jar: x.jar, payload: { password: PASSWORD } });
    const deleted = await call(app, 'GET', `/admin/users?deleted=true&search=${encodeURIComponent(x.email)}`, { jar: admin.jar });
    const item = deleted.body?.data?.items?.[0];
    expect(item?.id).toBe(x.id);
    expect((new Date(item.purgeAt).getTime() - new Date(item.deletedAt).getTime()) / 86_400_000).toBe(30);
    const live = await call(app, 'GET', `/admin/users?search=${encodeURIComponent(x.email)}`, { jar: admin.jar });
    expect(live.body?.data?.items).toHaveLength(0);
  });

  it('restore → 200 (active, no avatar); the user signs in with the old password; again → 409, unknown → 404, non-admin → 403', async () => {
    const restore = await call(app, 'POST', `/admin/users/${x.id}/restore`, { jar: admin.jar });
    expect(restore.status).toBe(200);
    expect(restore.body?.data).toMatchObject({ deletedAt: null, isActive: true, avatarUrl: null });
    const userJar = await signIn(app, x.email);
    const again = await call(app, 'POST', `/admin/users/${x.id}/restore`, { jar: admin.jar });
    expect([again.status, again.code]).toEqual([409, 'USER_NOT_DELETED']);
    const unknown = await call(app, 'POST', '/admin/users/00000000-0000-4000-8000-000000000000/restore', { jar: admin.jar });
    expect([unknown.status, unknown.code]).toEqual([404, 'USER_NOT_FOUND']);
    expect((await call(app, 'POST', `/admin/users/${x.id}/restore`, { jar: userJar })).status).toBe(403);
  });

  it('the purge removes an account deleted 31 days ago (restore then 404); the restored account stays', async () => {
    const y = await registerUser(app, 'purged');
    await call(app, 'DELETE', '/users/me', { jar: y.jar, payload: { password: PASSWORD } });
    await (await db()).user.update({ where: { id: y.id }, data: { deletedAt: new Date(Date.now() - 31 * 86_400_000) } });
    const { purgeDeletedAccounts } = await import('@jobs/cleanup-deleted-accounts.job.js');
    await purgeDeletedAccounts();
    expect(await (await db()).user.count({ where: { id: y.id } })).toBe(0);
    expect((await call(app, 'POST', `/admin/users/${y.id}/restore`, { jar: admin.jar })).status).toBe(404);
    expect((await (await db()).user.findUnique({ where: { id: x.id } }))?.deletedAt).toBeNull();
  });

  it('user detail has lastActiveAt and no lastLogin', async () => {
    const d = await call(app, 'GET', `/admin/users/${x.id}`, { jar: admin.jar });
    expect(d.status).toBe(200);
    expect(d.body?.data).toHaveProperty('lastActiveAt');
    expect(d.body?.data).not.toHaveProperty('lastLogin');
  });
});

describe('makeAdmin helper sanity', () => {
  it('a promoted account reaches the admin API at once (the role is read on every request)', async () => {
    const u = await registerUser(app, 'helper');
    expect((await call(app, 'GET', '/admin/stats', { jar: u.jar })).status).toBe(403);
    await makeAdmin(u.id);
    expect((await call(app, 'GET', '/admin/stats', { jar: u.jar })).status).toBe(200);
  });
});
