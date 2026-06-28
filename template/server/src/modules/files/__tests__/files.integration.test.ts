/**
 * Files-route integration test — the load-bearing proof that the two-tier
 * upload split (P0-2) closes the @fastify/static over-exposure.
 *
 * Drives the REAL Fastify app via `app.inject()` against the MySQL 8 + Redis
 * booted by `src/test/integration.setup.ts`. The setup file points
 * UPLOAD_PUBLIC_DIR / UPLOAD_PRIVATE_DIR at isolated temp dirs (exported via
 * `containerInfo`) BEFORE env.ts is evaluated, so this test controls the files
 * on disk and asserts exactly what is and isn't reachable.
 *
 * What this proves:
 *   1. PUBLIC static still works WITHOUT auth (avatar URL shape unchanged).
 *   2. EXPOSURE CLOSED — a file in the PRIVATE tier is NOT reachable via the
 *      static /uploads/... path (404).
 *   3. The auth-gated route: 401 without a cookie, 200 + bytes with one, 206 +
 *      Content-Range for a Range request, 404 for a traversal attempt.
 *
 * Env-before-import: `@/app` is imported LAZILY inside `beforeAll`, after the
 * setup file has populated process.env. See integration.setup.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { containerInfo } from '@/test/integration.setup.js';

let app: FastifyInstance;

/** Pull a named cookie value out of a set-cookie header array. */
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

const filesUser = {
  email: 'files-route@example.com',
  password: 'Password123!',
  firstName: 'Files',
  lastName: 'Route',
};

let accessCookie: string;
let userId: string;

const PRIVATE_BODY = 'the-quick-brown-fox-private-bytes';

beforeAll(async () => {
  const { buildApp } = await import('@/app.js');
  app = await buildApp();
  await app.ready();

  // Register + login to mint an authed cookie and learn the user id.
  const reg = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: filesUser });
  expect(reg.statusCode).toBe(201);
  userId = reg.json().data.user.id as string;
  expect(userId).toBeTruthy();

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: filesUser.email, password: filesUser.password },
  });
  expect(login.statusCode).toBe(200);
  const cookie = extractCookie(login.headers['set-cookie'], 'access_token');
  expect(cookie, 'login must set an access_token cookie').toBeTruthy();
  accessCookie = cookie!;

  // --- Seed fixtures directly on disk, in the temp tiers the app reads. ---
  // PUBLIC avatar (served statically, no auth).
  const publicAvatarDir = path.join(containerInfo.uploadPublicDir, 'users', userId, 'avatar');
  await fs.mkdir(publicAvatarDir, { recursive: true });
  await fs.writeFile(path.join(publicAvatarDir, 'x.webp'), Buffer.from('PUBLIC-AVATAR-BYTES'));

  // PRIVATE file (auth-gated route only).
  const privateUserDir = path.join(containerInfo.uploadPrivateDir, 'users', userId);
  await fs.mkdir(privateUserDir, { recursive: true });
  await fs.writeFile(path.join(privateUserDir, 'doc.txt'), Buffer.from(PRIVATE_BODY));

  // A SECRET file in the private tier, addressable only via traversal from the
  // static root — used to prove the static mount cannot reach the private tier.
  await fs.writeFile(path.join(containerInfo.uploadPrivateDir, 'secret.txt'), Buffer.from('TOP-SECRET'));
});

afterAll(async () => {
  await app?.close();
});

describe('files two-tier uploads (real containers)', () => {
  it('PUBLIC: GET /uploads/users/{id}/avatar/x.webp WITHOUT auth → 200 (static still served)', async () => {
    const res = await app.inject({ method: 'GET', url: `/uploads/users/${userId}/avatar/x.webp` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('PUBLIC-AVATAR-BYTES');
  });

  it('EXPOSURE CLOSED: a PRIVATE-tier file is NOT reachable via /uploads/... (404)', async () => {
    // Direct static path into the private tier does not exist under the public
    // root, and traversal out of the public root is blocked by @fastify/static.
    const direct = await app.inject({ method: 'GET', url: '/uploads/secret.txt' });
    expect(direct.statusCode).toBe(404);

    const traversal = await app.inject({
      method: 'GET',
      url: '/uploads/..%2f..%2fprivate%2fsecret.txt',
    });
    // @fastify/static rejects traversal (404/403); the one thing that must
    // never happen is a 200 leaking the private bytes.
    expect(traversal.statusCode).not.toBe(200);
  });

  it('PRIVATE route WITHOUT auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/files/doc.txt' });
    expect(res.statusCode).toBe(401);
  });

  it('PRIVATE route WITH auth → 200 and the file bytes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/doc.txt',
      cookies: { access_token: accessCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(PRIVATE_BODY);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['cache-control']).toBe('private');
    expect(res.headers['content-type']).toContain('text/plain');
  });

  it('PRIVATE route with a Range header → 206 + correct Content-Range', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/doc.txt',
      cookies: { access_token: accessCookie },
      headers: { range: 'bytes=0-3' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-3/${PRIVATE_BODY.length}`);
    expect(res.headers['content-length']).toBe('4');
    expect(res.body).toBe(PRIVATE_BODY.slice(0, 4));
  });

  it('PRIVATE route traversal attempt → 404 (no existence leak, not 403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/files/..%2f..%2fsecret',
      cookies: { access_token: accessCookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
