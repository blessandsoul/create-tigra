/**
 * Admin role-gate integration test against REAL containers.
 *
 * Exercises the admin-gated route (`GET /api/v1/admin/stats`, behind
 * `authenticate` + `authorize('ADMIN')`) at all three gates:
 *   - 401 unauthenticated
 *   - 403 as a normal logged-in USER
 *   - 200 as an ADMIN
 *
 * The register endpoint cannot mint admins, so we SEED an ADMIN User row
 * directly via prisma against the container DB, hashing the password with the
 * server's own `@libs/password` lib so the real login path verifies it.
 *
 * Env-before-import: `@/app`, `@/libs/prisma`, `@/libs/password` are all
 * imported LAZILY inside `beforeAll`, after integration.setup.ts has populated
 * process.env with the container URLs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let prisma: typeof import('@/libs/prisma.js')['prisma'];

function extractCookie(setCookie: string[] | string | undefined, name: string): string | undefined {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const header of headers) {
    const first = header.split(';')[0];
    const eq = first.indexOf('=');
    if (eq === -1) continue;
    if (first.slice(0, eq).trim() === name) {
      return first.slice(eq + 1).trim();
    }
  }
  return undefined;
}

async function loginAndGetAccessCookie(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode, `login for ${email} should succeed`).toBe(200);
  const cookie = extractCookie(res.headers['set-cookie'], 'access_token');
  expect(cookie, `login for ${email} must set an access_token cookie`).toBeTruthy();
  return cookie!;
}

const adminCreds = { email: 'admin-it@example.com', password: 'AdminPass123!' };
const userCreds = {
  email: 'normal-it@example.com',
  password: 'UserPass123!',
  firstName: 'Normal',
  lastName: 'User',
};

let adminCookie: string;
let userCookie: string;

beforeAll(async () => {
  const [{ buildApp }, prismaMod, { hashPassword }] = await Promise.all([
    import('@/app.js'),
    import('@/libs/prisma.js'),
    import('@/libs/password.js'),
  ]);
  prisma = prismaMod.prisma;

  app = await buildApp();
  await app.ready();

  // Seed an ADMIN directly — the register endpoint only mints USER role.
  await prisma.user.create({
    data: {
      email: adminCreds.email,
      password: await hashPassword(adminCreds.password),
      firstName: 'Admin',
      lastName: 'It',
      role: 'ADMIN',
      isActive: true,
    },
  });

  // Create the normal user via the real register endpoint.
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: userCreds,
  });
  expect(reg.statusCode).toBe(201);

  adminCookie = await loginAndGetAccessCookie(adminCreds.email, adminCreds.password);
  userCookie = await loginAndGetAccessCookie(userCreds.email, userCreds.password);
});

afterAll(async () => {
  await app?.close();
});

describe('admin role gate (real containers)', () => {
  const ADMIN_ROUTE = '/api/v1/admin/stats';

  it('rejects an UNAUTHENTICATED request (401)', async () => {
    const res = await app.inject({ method: 'GET', url: ADMIN_ROUTE });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a normal logged-in USER (403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: ADMIN_ROUTE,
      cookies: { access_token: userCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows an ADMIN (200)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: ADMIN_ROUTE,
      cookies: { access_token: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    // Dashboard stats shape (see admin.controller.getDashboardStats).
    expect(body.data).toHaveProperty('totalUsers');
  });
});
