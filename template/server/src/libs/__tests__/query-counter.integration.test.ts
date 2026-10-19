/**
 * The dev/test-only X-Query-Count header (../query-counter.ts) against a real
 * database: it must count the Prisma queries each request makes, model
 * queries and raw ones alike, and 0 for a request that makes none.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let cookie = '';

const queryCount = (res: { headers: Record<string, unknown> }): number => Number(res.headers['x-query-count']);

beforeAll(async () => {
  const { buildApp } = await import('@/app.js');
  app = await buildApp();
  await app.ready();
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email: `qc-${Date.now()}@example.test`, password: 'Integration-Passw0rd!', firstName: 'Query', lastName: 'Counter' },
  });
  expect(reg.statusCode).toBe(201);
  const setCookie = ([] as string[]).concat(reg.headers['set-cookie'] ?? []);
  cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
});

afterAll(async () => {
  await app?.close();
});

describe('X-Query-Count', () => {
  it('counts the model queries of a signed-in request (/auth/me reads the session and the user)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(queryCount(res)).toBeGreaterThanOrEqual(1);
  });

  it('counts raw queries too (/ready runs SELECT 1)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(res.statusCode).toBe(200);
    expect(queryCount(res)).toBe(1);
  });

  it('is 0 for a request without queries, and one request never counts another one', async () => {
    const [live, me] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/v1/live' }),
      app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } }),
    ]);
    expect(queryCount(live)).toBe(0);
    expect(queryCount(me)).toBeGreaterThanOrEqual(1);
  });
});
