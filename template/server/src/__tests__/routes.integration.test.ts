/**
 * The contract of every API route, in the real app against a real MySQL and
 * Redis: who may call it (401 anonymous, 403 the wrong user or role), what
 * wrong input answers (422 VALIDATION_FAILED with the field list), and its
 * success answer. The deeper guarantees of each area live in that area's own
 * integration file. Add rows here for every new route: the last test fails,
 * naming the route, when a registered route is never called in this file and is
 * not in COVERED_ELSEWHERE (routes another file tests, with that file's name).
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { integrationServices } from '@/test/integration.setup.js';
import {
  PASSWORD,
  buildTestApp,
  call,
  image,
  multipartFile,
  registerAdmin,
  registerUser,
  routeCoverage,
  signIn,
  startEmailStub,
  tokenOf,
  uniqueEmail,
  uploadAvatar,
  type EmailStub,
  type TestUser,
} from '@/test/integration-helpers.js';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** A valid UUID that belongs to nobody. */
const NOBODY = '00000000-0000-4000-8000-000000000000';

const ADMIN_ROUTES: [Method, string][] = [
  ['GET', '/admin/blocked-ips'],
  ['GET', '/admin/client-ip'],
  ['POST', '/admin/blocked-ips'],
  ['DELETE', '/admin/blocked-ips/203.0.113.9'],
  ['GET', '/admin/health'],
  ['GET', '/admin/stats'],
  ['GET', '/admin/users'],
  ['GET', `/admin/users/${NOBODY}`],
  ['PATCH', `/admin/users/${NOBODY}/status`],
  ['POST', `/admin/users/${NOBODY}/restore`],
  ['PATCH', `/admin/users/${NOBODY}/role`],
  ['GET', '/admin/sessions'],
  ['DELETE', `/admin/sessions/${NOBODY}`],
];

const SIGNED_IN_ROUTES: [Method, string][] = [
  ['GET', '/auth/me'],
  ['GET', '/auth/sessions'],
  ['POST', '/auth/logout-all'],
  ['PATCH', '/users/me'],
  ['PATCH', '/users/me/password'],
  ['DELETE', '/users/me'],
  ['POST', '/users/avatar'],
  ['DELETE', '/users/avatar'],
  ['PATCH', `/users/${NOBODY}`],
  ['PATCH', `/users/${NOBODY}/password`],
  ['DELETE', `/users/${NOBODY}`],
  ['POST', `/users/${NOBODY}/avatar`],
  ['DELETE', `/users/${NOBODY}/avatar`],
  ['GET', '/files/anything.txt'],
  ...ADMIN_ROUTES,
];

/**
 * Routes whose contract lives in another file, with that file. Only the routes
 * this file does not call belong here. The email-verification module's routes
 * exist only in projects that installed it; listing them is harmless elsewhere.
 */
const COVERED_ELSEWHERE: Record<string, string> = {
  'GET /api/v1/health': 'src/libs/__tests__/health.integration.test.ts',
  'GET /api/v1/ready': 'src/libs/__tests__/health.integration.test.ts',
  'GET /api/v1/live': 'src/libs/__tests__/health.integration.test.ts',
  'GET /uploads/*': 'src/modules/files/__tests__/files.integration.test.ts',
  'POST /api/v1/auth/send-verification': 'src/modules/auth/__tests__/verification.integration.test.ts (email-verification module)',
  'POST /api/v1/auth/verify-account': 'src/modules/auth/__tests__/verification.integration.test.ts (email-verification module)',
};

/** Records which routes this file calls (the last test checks it). */
const coverage = routeCoverage();

let app: FastifyInstance;
let mail: EmailStub;
let admin: TestUser;
let user: TestUser;

beforeAll(async () => {
  mail = await startEmailStub();
  app = await buildTestApp({ onRoute: coverage.onRoute });
  admin = await registerAdmin(app, 'contract-admin');
  user = await registerUser(app, 'contract-user');
});

afterAll(async () => {
  await app?.close();
  await mail?.close();
});

describe('who may call', () => {
  it.each(SIGNED_IN_ROUTES)('%s %s anonymously → 401', async (method, url) => {
    expect((await call(app, method, url)).status).toBe(401);
  });

  it.each(ADMIN_ROUTES)('%s %s as a USER → 403', async (method, url) => {
    expect((await call(app, method, url, { jar: user.jar })).status).toBe(403);
  });

  it.each([
    ['PATCH', '', { firstName: 'Hacker' }],
    ['PATCH', '/password', { currentPassword: PASSWORD, newPassword: 'Other-Passw0rd-1' }],
    ['DELETE', '', { password: PASSWORD }],
    ['DELETE', '/avatar', undefined],
  ] as const)("%s /users/<someone else>%s → 403", async (method, suffix, payload) => {
    const owner = await registerUser(app, 'contract-owner');
    const r = await call(app, method, `/users/${owner.id}${suffix}`, { jar: user.jar, payload });
    expect(r.status).toBe(403);
  });

  it("POST /users/<someone else>/avatar → 403", async () => {
    const owner = await registerUser(app, 'contract-owner-av');
    expect((await uploadAvatar(app, user.jar, await image('png'), { url: `/users/${owner.id}/avatar` })).status).toBe(403);
  });
});

describe('wrong input → 422 VALIDATION_FAILED, naming the fields', () => {
  it.each([
    ['POST', '/auth/register', { email: 'x' }, 'none'],
    ['POST', '/auth/login', { email: 'x' }, 'none'],
    ['POST', '/auth/forgot-password', { email: 'x' }, 'none'],
    ['POST', '/auth/reset-password', {}, 'none'],
    ['PATCH', '/users/me', {}, 'user'],
    ['PATCH', '/users/me/password', {}, 'user'],
    ['DELETE', '/users/me', {}, 'user'],
    // As an admin: for a USER the owner-or-admin check runs first (403), so a
    // stranger cannot even probe another path's validation.
    ['PATCH', '/users/not-a-uuid', { firstName: 'Valid' }, 'admin'],
    ['POST', '/admin/blocked-ips', {}, 'admin'],
    ['GET', '/admin/users?limit=abc', undefined, 'admin'],
    ['GET', '/admin/users/not-a-uuid', undefined, 'admin'],
    ['PATCH', `/admin/users/${NOBODY}/status`, {}, 'admin'],
    ['PATCH', `/admin/users/${NOBODY}/role`, { role: 'GOD' }, 'admin'],
    ['GET', '/admin/sessions?userId=nope', undefined, 'admin'],
    ['DELETE', '/admin/sessions/not-a-uuid', undefined, 'admin'],
  ] as const)('%s %s', async (method, url, payload, who) => {
    const jar = who === 'admin' ? admin.jar : who === 'user' ? user.jar : undefined;
    const r = await call(app, method, url, { jar, payload });
    expect([r.status, r.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect(Array.isArray(r.body?.error?.fields)).toBe(true);
  });
});

describe('auth routes answer', () => {
  it('register 201 (and signs in), login 200, me 200, sessions 200, refresh 200', async () => {
    const email = uniqueEmail('contract-auth');
    const reg = await call(app, 'POST', '/auth/register', { payload: { email, password: PASSWORD, firstName: 'Con', lastName: 'Tract' } });
    expect([reg.status, reg.body?.data?.user?.email]).toEqual([201, email]);
    const jar = await signIn(app, email);
    expect((await call(app, 'GET', '/auth/me', { jar })).body?.data?.email).toBe(email);
    const sessions = await call(app, 'GET', '/auth/sessions', { jar });
    expect([sessions.status, Array.isArray(sessions.body?.data) && sessions.body?.data.length >= 1]).toEqual([200, true]);
    expect((await call(app, 'POST', '/auth/refresh', { jar })).status).toBe(200);
  });

  it('logout 200 (also without a session), logout-all 200', async () => {
    const u = await registerUser(app, 'contract-logout');
    expect((await call(app, 'POST', '/auth/logout', { jar: u.jar })).status).toBe(200);
    expect((await call(app, 'POST', '/auth/logout')).status).toBe(200);
    const v = await registerUser(app, 'contract-logoutall');
    expect((await call(app, 'POST', '/auth/logout-all', { jar: v.jar })).status).toBe(200);
  });

  it('forgot-password 200 for any address; reset-password 200 with the emailed token, 400 with another', async () => {
    const u = await registerUser(app, 'contract-reset');
    expect((await call(app, 'POST', '/auth/forgot-password', { payload: { email: u.email } })).status).toBe(200);
    expect((await call(app, 'POST', '/auth/forgot-password', { payload: { email: uniqueEmail('nobody') } })).status).toBe(200);
    const token = tokenOf(mail.to(u.email).at(-1)?.link ?? null);
    expect((await call(app, 'POST', '/auth/reset-password', { payload: { token, newPassword: 'Reset-Passw0rd-1' } })).status).toBe(200);
    const bad = await call(app, 'POST', '/auth/reset-password', { payload: { token: 'f'.repeat(64), newPassword: 'Reset-Passw0rd-1' } });
    expect([bad.status, bad.code]).toEqual([400, 'INVALID_RESET_TOKEN']);
  });
});

describe('users routes answer', () => {
  it('/users/me: PATCH 200, password 200, avatar POST 200 and DELETE 200, DELETE account 200', async () => {
    const u = await registerUser(app, 'contract-me');
    expect((await call(app, 'PATCH', '/users/me', { jar: u.jar, payload: { lastName: 'Renamed' } })).body?.data?.lastName).toBe('Renamed');
    const pw = await call(app, 'PATCH', '/users/me/password', { jar: u.jar, payload: { currentPassword: PASSWORD, newPassword: 'Changed-Passw0rd-1' } });
    expect(pw.status).toBe(200);
    expect((await uploadAvatar(app, u.jar, await image('jpeg'))).status).toBe(200);
    expect((await call(app, 'DELETE', '/users/avatar', { jar: u.jar })).status).toBe(200);
    expect((await call(app, 'DELETE', '/users/me', { jar: u.jar, payload: { password: 'Changed-Passw0rd-1' } })).status).toBe(200);
  });

  it('/users/:userId as the owner: PATCH 200, password 200, avatar POST 200 and DELETE 200', async () => {
    const u = await registerUser(app, 'contract-byid');
    const base = `/users/${u.id}`;
    expect((await call(app, 'PATCH', base, { jar: u.jar, payload: { firstName: 'Owner' } })).status).toBe(200);
    expect((await call(app, 'PATCH', `${base}/password`, { jar: u.jar, payload: { currentPassword: PASSWORD, newPassword: 'Owner-Passw0rd-1' } })).status).toBe(200);
    const { payload, headers } = multipartFile(await image('png'));
    expect((await call(app, 'POST', `${base}/avatar`, { jar: u.jar, payload, headers })).status).toBe(200);
    expect((await call(app, 'DELETE', `${base}/avatar`, { jar: u.jar })).status).toBe(200);
  });

  it('/users/:userId as an admin: password 200 (no current password), DELETE 200; an unknown id 404', async () => {
    const u = await registerUser(app, 'contract-adminbyid');
    expect((await call(app, 'PATCH', `/users/${u.id}/password`, { jar: admin.jar, payload: { newPassword: 'Admin-Set-Passw0rd-1' } })).status).toBe(200);
    expect((await call(app, 'DELETE', `/users/${u.id}`, { jar: admin.jar })).status).toBe(200);
    expect((await call(app, 'PATCH', `/users/${NOBODY}`, { jar: admin.jar, payload: { firstName: 'Ghost' } })).status).toBe(404);
  });

  it('GET /files/:filename: the owner 200, a missing file 404', async () => {
    const dir = path.join(integrationServices.uploadPrivateDir, 'users', user.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'contract.txt'), 'contract');
    expect((await call(app, 'GET', '/files/contract.txt', { jar: user.jar })).status).toBe(200);
    expect((await call(app, 'GET', '/files/missing.txt', { jar: user.jar })).status).toBe(404);
  });
});

describe('admin routes answer', () => {
  it('stats, health, client-ip and blocked-ips lists → 200 with their shapes', async () => {
    const stats = await call(app, 'GET', '/admin/stats', { jar: admin.jar });
    expect(stats.status).toBe(200);
    expect(stats.body?.data).toEqual(expect.objectContaining({ totalUsers: expect.any(Number) }));
    expect((await call(app, 'GET', '/admin/health', { jar: admin.jar })).status).toBe(200);
    expect(Object.keys((await call(app, 'GET', '/admin/client-ip', { jar: admin.jar })).body?.data ?? {}).sort()).toEqual(['ip', 'source']);
    expect(Object.keys((await call(app, 'GET', '/admin/blocked-ips', { jar: admin.jar })).body?.data ?? {}).sort()).toEqual(['autoBlocked', 'permanent']);
  });

  it('block 201, unblock 200', async () => {
    expect((await call(app, 'POST', '/admin/blocked-ips', { jar: admin.jar, payload: { ip: '203.0.113.99' } })).status).toBe(201);
    expect((await call(app, 'DELETE', '/admin/blocked-ips/203.0.113.99', { jar: admin.jar })).status).toBe(200);
  });

  it('users list 200 (paginated), detail 200 / unknown 404, status 200, role 200, restore 200 / not deleted 409', async () => {
    const u = await registerUser(app, 'contract-managed');
    const list = await call(app, 'GET', `/admin/users?search=${encodeURIComponent(u.email)}`, { jar: admin.jar });
    expect([list.status, list.body?.data?.items?.[0]?.id]).toEqual([200, u.id]);
    expect((await call(app, 'GET', `/admin/users/${u.id}`, { jar: admin.jar })).status).toBe(200);
    expect((await call(app, 'GET', `/admin/users/${NOBODY}`, { jar: admin.jar })).status).toBe(404);
    expect((await call(app, 'PATCH', `/admin/users/${u.id}/role`, { jar: admin.jar, payload: { role: 'ADMIN' } })).status).toBe(200);
    expect((await call(app, 'PATCH', `/admin/users/${u.id}/role`, { jar: admin.jar, payload: { role: 'USER' } })).status).toBe(200);
    expect((await call(app, 'PATCH', `/admin/users/${u.id}/status`, { jar: admin.jar, payload: { isActive: false } })).status).toBe(200);
    expect((await call(app, 'PATCH', `/admin/users/${u.id}/status`, { jar: admin.jar, payload: { isActive: true } })).status).toBe(200);
    expect((await call(app, 'POST', `/admin/users/${u.id}/restore`, { jar: admin.jar })).status).toBe(409);
    await call(app, 'DELETE', `/users/${u.id}`, { jar: admin.jar });
    expect((await call(app, 'POST', `/admin/users/${u.id}/restore`, { jar: admin.jar })).status).toBe(200);
  });

  it('sessions list 200, revoke 200 / unknown 404', async () => {
    const u = await registerUser(app, 'contract-session');
    const list = await call(app, 'GET', `/admin/sessions?userId=${u.id}`, { jar: admin.jar });
    expect(list.status).toBe(200);
    const sessionId = list.body?.data?.items?.[0]?.id as string;
    expect((await call(app, 'DELETE', `/admin/sessions/${sessionId}`, { jar: admin.jar })).status).toBe(200);
    expect((await call(app, 'DELETE', `/admin/sessions/${NOBODY}`, { jar: admin.jar })).status).toBe(404);
  });
});

/** The parts of a Vitest task this file reads: a suite has `tasks`, a test does not. */
type TaskLike = { mode: string; tasks?: TaskLike[] };
const testsIn = (t: TaskLike): TaskLike[] => (t.tasks ? t.tasks.flatMap(testsIn) : [t]);

// Keep this last: it reads what every test above called (tests in a file run in order).
describe('no route is forgotten', () => {
  it('every registered route was called above, or is in COVERED_ELSEWHERE', ({ task, skip }) => {
    // With a name filter (-t) the other tests did not run, so their routes would look uncalled.
    const self = task as unknown as TaskLike;
    const others = testsIn(task.file as unknown as TaskLike).filter((t) => t !== self);
    if (others.some((t) => t.mode === 'skip' || t.mode === 'todo')) skip('needs the whole file to run');
    expect(coverage.uncalled(COVERED_ELSEWHERE)).toEqual([]);
  });
});
