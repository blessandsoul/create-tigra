/**
 * The real app while Redis is unreachable: it keeps serving, public /health
 * says "degraded" (nothing more), and the admin report names Redis. Redis is
 * "down" by pointing this file's app at a closed port before it loads, so no
 * real service is touched.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, call, makeAdmin, registerUser } from '@/test/integration-helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  process.env.REDIS_URL = 'redis://127.0.0.1:6599/15'; // nothing listens there
  app = await buildTestApp();
});

afterAll(async () => {
  await app?.close();
});

describe('Redis down', () => {
  it('public /health → 200 with only { status: "degraded" }', async () => {
    const r = await call(app, 'GET', '/health');
    expect(r.status).toBe(200);
    expect(r.body?.data).toEqual({ status: 'degraded' });
    expect(r.res.body).not.toMatch(/redis/i);
  });

  it('the admin report says which check failed: redis down, overall degraded', async () => {
    const u = await registerUser(app, 'redisdown-admin');
    await makeAdmin(u.id);
    const r = await call(app, 'GET', '/admin/health', { jar: u.jar });
    expect(r.status).toBe(200);
    expect([r.body?.data?.status, r.body?.data?.checks?.redis?.status, r.body?.data?.checks?.database?.status]).toEqual([
      'degraded',
      'down',
      'up',
    ]);
  });

  it('/ready stays 200: the database is what readiness needs', async () => {
    expect((await call(app, 'GET', '/ready')).status).toBe(200);
  });
});
