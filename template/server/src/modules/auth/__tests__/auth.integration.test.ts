/**
 * Money-path integration test — auth flow against REAL containers.
 *
 * No payments module exists in the scaffold, so the auth flow (register → login →
 * authenticated read) is the money-adjacent critical path. This drives the REAL
 * Fastify app via `app.inject()` against a real MySQL 8 + Redis booted by
 * `src/test/integration.setup.ts`.
 *
 * Env-before-import: `@/app` (which pulls `env.ts` + prisma) is imported LAZILY
 * inside `beforeAll`, AFTER the setup file has populated process.env with the
 * container URLs. See integration.setup.ts for the full rationale.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

/**
 * Pull the `access_token` cookie value out of a set-cookie header array.
 * The login/register controllers set `access_token`, `refresh_token`, and a
 * non-httpOnly `auth_session` indicator (see src/libs/cookies.ts).
 */
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

const validUser = {
  email: 'moneypath@example.com',
  password: 'Password123!',
  firstName: 'Money',
  lastName: 'Path',
};

beforeAll(async () => {
  // LAZY import — env is now populated by integration.setup.ts.
  const { buildApp } = await import('@/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

describe('auth money-path (real containers)', () => {
  let accessCookie: string | undefined;

  it('POST /api/v1/auth/register with a valid body succeeds (201) and returns the user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: validUser,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe(validUser.email);
    expect(body.data.user.role).toBe('USER');
    // Password must never be echoed back.
    expect(body.data.user.password).toBeUndefined();
  });

  it('POST /api/v1/auth/register with an INVALID body is rejected (400, Zod validation)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'not-an-email', password: 'short', firstName: 'A', lastName: '' },
    });

    // fastify-type-provider-zod surfaces body validation as a Fastify
    // validation error → the app's error handler maps it to 400 BAD_REQUEST.
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/v1/auth/login with valid credentials succeeds and sets an access_token cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: validUser.email, password: validUser.password },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe(validUser.email);

    const setCookie = res.headers['set-cookie'];
    accessCookie = extractCookie(setCookie, 'access_token');
    expect(accessCookie, 'login must set an access_token cookie').toBeTruthy();
    // The refresh cookie is also set (path-scoped to /api/v1/auth).
    expect(extractCookie(setCookie, 'refresh_token')).toBeTruthy();
  });

  it('POST /api/v1/auth/login with a wrong password fails (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: validUser.email, password: 'WrongPassword123!' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('GET /api/v1/auth/me WITHOUT the cookie is rejected (401)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    });

    expect(res.statusCode).toBe(401);
  });

  it('GET /api/v1/auth/me WITH the access_token cookie returns 200 and the right user', async () => {
    expect(accessCookie, 'login test must have captured the cookie first').toBeTruthy();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { access_token: accessCookie! },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.email).toBe(validUser.email);
    expect(body.data.role).toBe('USER');
  });
});
