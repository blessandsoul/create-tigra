/**
 * Identity and sessions against a real MySQL and Redis: what must stay true
 * about tokens and sessions (the layer 3 hardening).
 * - Refresh and reset tokens are stored as fingerprints, never as issued.
 * - Two refreshes with the same cookie at once: exactly one wins; the other
 *   gets 401 REFRESH_TOKEN_ROTATED and keeps its cookies.
 * - An access token dies with its session (logout, logout-all, password
 *   reset, admin revoke), and a token without a session id is refused.
 * - A reset link works once, even when used twice at the same moment.
 * - Wrong passwords on change/delete answer 422, a ban stops refresh at once,
 *   15 wrong sign-ins lock the email for this address, hostile cookies never
 *   cause a 500.
 * Emails go to an in-process Resend stub; nothing is sent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  PASSWORD,
  call,
  clearsCookies,
  db,
  redis,
  registerAdmin,
  registerUser,
  signIn,
  startEmailStub,
  tokenOf,
  uniqueEmail,
  type CookieJar,
  type EmailStub,
} from '@/test/integration-helpers.js';

let app: FastifyInstance;
let mail: EmailStub;

beforeAll(async () => {
  mail = await startEmailStub();
  const { buildTestApp } = await import('@/test/integration-helpers.js');
  app = await buildTestApp();
});

afterAll(async () => {
  await app?.close();
  await mail?.close();
});

/** Only the access token of a jar, as a Cookie header (so a refresh cannot rescue it). */
const accessOnly = (jar: CookieJar): string => `access_token=${jar.get('access_token')}`;

/** Requests a reset link for the address and returns its raw token. */
async function resetTokenFor(email: string): Promise<string> {
  const r = await call(app, 'POST', '/auth/forgot-password', { payload: { email } });
  expect(r.status).toBe(200);
  return tokenOf(mail.to(email).filter((e) => /reset-password/.test(e.link ?? '')).at(-1)?.link ?? null);
}

describe('tokens are stored as fingerprints', () => {
  it('refresh tokens in the database are 64-hex SHA-256 fingerprints, never the cookie value', async () => {
    const u = await registerUser(app, 'fp');
    const rows = await (await db()).refreshToken.findMany({ where: { userId: u.id }, select: { token: true } });
    const cookieValue = decodeURIComponent(u.jar.get('refresh_token') ?? '');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.token))).toBe(true);
    expect(cookieValue.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.token)).not.toContain(cookieValue);
  });

  it('no reset key or pointer in Redis holds the raw reset token', async () => {
    const u = await registerUser(app, 'resetkey');
    const raw = await resetTokenFor(u.email);
    const keys = await (await redis()).keys('pw-reset*');
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.join('\n')).not.toContain(raw);
    for (const key of keys) {
      const type = await (await redis()).type(key);
      const value = type === 'string' ? await (await redis()).get(key) : JSON.stringify(await (await redis()).hgetall(key));
      expect(value ?? '').not.toContain(raw);
    }
  });
});

describe('parallel refresh', () => {
  it('two refreshes with the same cookie: one 200, one 401 REFRESH_TOKEN_ROTATED that keeps its cookies', async () => {
    const u = await registerUser(app, 'race');
    const otherDevice = await signIn(app, u.email);
    let raced: { winner: Awaited<ReturnType<typeof call>>; loser: Awaited<ReturnType<typeof call>> } | null = null;
    // A real race: on a fast machine both can still land one after the other; try a few times.
    for (let attempt = 0; attempt < 8 && !raced; attempt++) {
      const device = await signIn(app, u.email);
      const sameCookie = device.header();
      const pair = await Promise.all([
        call(app, 'POST', '/auth/refresh', { cookie: sameCookie }),
        call(app, 'POST', '/auth/refresh', { cookie: sameCookie }),
      ]);
      const winner = pair.find((r) => r.status === 200);
      const loser = pair.find((r) => r.code === 'REFRESH_TOKEN_ROTATED');
      if (winner && loser) raced = { winner, loser };
      for (const r of pair) expect(r.status).not.toBe(500);
    }
    expect(raced, 'no attempt produced a real race').not.toBeNull();
    expect(raced!.loser.status).toBe(401);
    expect(clearsCookies(raced!.loser.res)).toBe(false);

    // The winner's new refresh token works afterwards; another device was not touched.
    const { CookieJar } = await import('@/test/integration-helpers.js');
    const winnerJar = new CookieJar().absorb(raced!.winner.res);
    expect((await call(app, 'POST', '/auth/refresh', { jar: winnerJar })).status).toBe(200);
    expect((await call(app, 'GET', '/auth/me', { jar: otherDevice })).status).toBe(200);
  });
});

describe('an access token ends with its session', () => {
  it('logout: the old access token is refused at once (401 SESSION_EXPIRED, cookies cleared); another device stays in', async () => {
    const u = await registerUser(app, 'logout');
    const otherDevice = await signIn(app, u.email);
    const token = accessOnly(u.jar);
    expect((await call(app, 'GET', '/auth/me', { cookie: token })).status).toBe(200);
    await call(app, 'POST', '/auth/logout', { jar: u.jar });
    const after = await call(app, 'GET', '/auth/me', { cookie: token });
    expect(after.status).toBe(401);
    expect(after.code).toBe('SESSION_EXPIRED');
    expect(clearsCookies(after.res)).toBe(true);
    // The token is bound to ITS session, not to "some live session of this user".
    expect((await call(app, 'GET', '/auth/me', { cookie: accessOnly(otherDevice) })).status).toBe(200);
  });

  it("logout-all: another device's access token is refused at once", async () => {
    const u = await registerUser(app, 'logoutall');
    const other = await signIn(app, u.email);
    await call(app, 'POST', '/auth/logout-all', { jar: u.jar });
    const r = await call(app, 'GET', '/auth/me', { cookie: accessOnly(other) });
    expect([r.status, r.code]).toEqual([401, 'SESSION_EXPIRED']);
  });

  it('password reset: every earlier access token is refused at once', async () => {
    const u = await registerUser(app, 'resetends');
    const other = await signIn(app, u.email);
    const token = await resetTokenFor(u.email);
    expect((await call(app, 'POST', '/auth/reset-password', { payload: { token, newPassword: 'New-Passw0rd-456!' } })).status).toBe(200);
    for (const jar of [u.jar, other]) {
      const r = await call(app, 'GET', '/auth/me', { cookie: accessOnly(jar) });
      expect([r.status, r.code]).toEqual([401, 'SESSION_EXPIRED']);
    }
  });

  it("admin revoke: that session's access token is refused at once", async () => {
    const admin = await registerAdmin(app, 'revoker');
    const victim = await registerUser(app, 'revoked');
    const sessions = await call(app, 'GET', '/auth/sessions', { jar: victim.jar });
    const newest = [...(sessions.body?.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const del = await call(app, 'DELETE', `/admin/sessions/${newest.id}`, { jar: admin.jar });
    expect(del.status).toBe(200);
    const r = await call(app, 'GET', '/auth/me', { cookie: accessOnly(victim.jar) });
    expect([r.status, r.code]).toEqual([401, 'SESSION_EXPIRED']);
  });

  it('a validly signed token without a session id is refused (401 SESSION_EXPIRED, cookies cleared)', async () => {
    const u = await registerUser(app, 'legacy');
    const legacy = app.jwt.sign({ userId: u.id, role: 'USER' } as never, { expiresIn: '15m' });
    const r = await call(app, 'GET', '/auth/me', { cookie: `access_token=${legacy}` });
    expect([r.status, r.code]).toEqual([401, 'SESSION_EXPIRED']);
    expect(clearsCookies(r.res)).toBe(true);
  });
});

describe('reset links', () => {
  it('the same link twice at once: exactly one 200, the other 400 INVALID_RESET_TOKEN', async () => {
    const u = await registerUser(app, 'resettwice');
    const token = await resetTokenFor(u.email);
    const answers = await Promise.all([
      call(app, 'POST', '/auth/reset-password', { payload: { token, newPassword: 'New-Passw0rd-456!' } }),
      call(app, 'POST', '/auth/reset-password', { payload: { token, newPassword: 'New-Passw0rd-789!' } }),
    ]);
    expect(answers.map((a) => `${a.status}${a.code ? ` ${a.code}` : ''}`).sort()).toEqual(['200', '400 INVALID_RESET_TOKEN']);
  });
});

describe('passwords and sign-in answers', () => {
  it('wrong current password on change → 422 INVALID_CURRENT_PASSWORD; on delete → 422 INVALID_PASSWORD', async () => {
    const u = await registerUser(app, 'wrongpw');
    const change = await call(app, 'PATCH', '/users/me/password', {
      jar: u.jar,
      payload: { currentPassword: 'Wrong-Passw0rd-1', newPassword: 'New-Passw0rd-456!' },
    });
    expect([change.status, change.code]).toEqual([422, 'INVALID_CURRENT_PASSWORD']);
    const del = await call(app, 'DELETE', '/users/me', { jar: u.jar, payload: { password: 'Wrong-Passw0rd-1' } });
    expect([del.status, del.code]).toEqual([422, 'INVALID_PASSWORD']);
  });

  it('the right current password changes it and keeps this device signed in', async () => {
    const u = await registerUser(app, 'rightpw');
    const change = await call(app, 'PATCH', '/users/me/password', {
      jar: u.jar,
      payload: { currentPassword: PASSWORD, newPassword: 'New-Passw0rd-456!' },
    });
    expect(change.status).toBe(200);
    expect((await call(app, 'GET', '/auth/me', { jar: u.jar })).status).toBe(200);
  });

  it('login → me → refresh → me works; a wrong password is 401 INVALID_CREDENTIALS; bad input is 422 with fields', async () => {
    const u = await registerUser(app, 'flow');
    const jar = await signIn(app, u.email);
    expect((await call(app, 'GET', '/auth/me', { jar })).status).toBe(200);
    expect((await call(app, 'POST', '/auth/refresh', { jar })).status).toBe(200);
    expect((await call(app, 'GET', '/auth/me', { jar })).status).toBe(200);
    const wrong = await call(app, 'POST', '/auth/login', { payload: { email: u.email, password: 'Wrong-Passw0rd-1' } });
    expect([wrong.status, wrong.code]).toEqual([401, 'INVALID_CREDENTIALS']);
    const bad = await call(app, 'POST', '/auth/register', { payload: { email: 'not-an-email', password: 'x', firstName: '', lastName: '' } });
    expect([bad.status, bad.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect(Array.isArray(bad.body?.error?.fields)).toBe(true);
  });

  it("a ban stops the user's refresh and says ACCOUNT_DEACTIVATED on their access token at once", async () => {
    const admin = await registerAdmin(app, 'banner');
    const victim = await registerUser(app, 'banned');
    expect((await call(app, 'GET', '/auth/me', { jar: victim.jar.copy() })).status).toBe(200);
    const ban = await call(app, 'PATCH', `/admin/users/${victim.id}/status`, { jar: admin.jar, payload: { isActive: false } });
    expect(ban.status).toBe(200);
    const refresh = await call(app, 'POST', '/auth/refresh', { cookie: victim.jar.header() });
    expect([refresh.status, refresh.code]).toEqual([401, 'INVALID_REFRESH_TOKEN']);
    const me = await call(app, 'GET', '/auth/me', { cookie: victim.jar.header() });
    expect([me.status, me.code]).toEqual([403, 'ACCOUNT_DEACTIVATED']);
    expect(clearsCookies(me.res)).toBe(true);
  });

  it('15 wrong sign-ins for one email from one address lock it (429 LOGIN_LOCKED)', async () => {
    const email = uniqueEmail('lock');
    const codes: (string | undefined)[] = [];
    for (let i = 0; i < 15; i++) {
      codes.push((await call(app, 'POST', '/auth/login', { payload: { email, password: 'Wrong-Passw0rd-1' } })).code);
    }
    expect(codes.slice(0, 14).every((c) => c === 'INVALID_CREDENTIALS')).toBe(true);
    expect(codes[14]).toBe('LOGIN_LOCKED');
  });
});

describe('hostile refresh cookies', () => {
  it.each([
    ['empty', ''],
    ['8 KB', 'x'.repeat(8192)],
    ['garbage', '%%%;;notatoken'],
  ])('a %s refresh cookie → 401, never 500', async (_label, value) => {
    const r = await call(app, 'POST', '/auth/refresh', { cookie: `refresh_token=${encodeURIComponent(value)}` });
    expect(r.status).toBe(401);
  });
});
