/**
 * The real app while the database is unreachable: public /health answers 503
 * with only { status: "unhealthy" }, /ready says not ready, /live (the Docker
 * HEALTHCHECK) still answers, and repeated probes inside 5 s reuse one failed
 * check. The database is "down" by pointing this file's app at a closed port
 * before it loads, so no real service is touched.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, call } from '@/test/integration-helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  process.env.DATABASE_URL = 'mysql://nobody:nothing@127.0.0.1:3399/closed_test'; // nothing listens there
  app = await buildTestApp();
});

afterAll(async () => {
  await app?.close();
});

describe('database down', () => {
  it('/health → 503 { status: "unhealthy" } only; /ready → 503 ready false; /live → 200', async () => {
    const health = await call(app, 'GET', '/health');
    expect([health.status, health.body?.data]).toEqual([503, { status: 'unhealthy' }]);
    const ready = await call(app, 'GET', '/ready');
    expect([ready.status, ready.body?.data?.ready]).toEqual([503, false]);
    expect((await call(app, 'GET', '/live')).status).toBe(200);
  });

  it('a second probe inside 5 s reuses the failed check (no new query)', async () => {
    const again = await call(app, 'GET', '/health');
    expect(again.status).toBe(503);
    expect(Number(again.res.headers['x-query-count'])).toBe(0);
  });
});
