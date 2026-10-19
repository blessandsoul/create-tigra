/**
 * The rate limits that guard the layer 3 and layer 8 promises, in the real
 * app with limits switched ON (they are off in every other integration
 * file): forgot-password emails one address at most 3 times an hour, and the
 * health probes are never limited while an ordinary route is.
 *
 * Kept short on purpose: every 429 counts as a violation for the client's
 * address, and enough of them would block it automatically. The file deletes
 * its limiter keys at the end, and checks the address was never blocked.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, call, redis, startEmailStub, uniqueEmail, type EmailStub } from '@/test/integration-helpers.js';

let app: FastifyInstance;
let mail: EmailStub;

beforeAll(async () => {
  process.env.RATE_LIMIT_ENABLED = 'true';
  process.env.RATE_LIMIT_OVERRIDES = 'DEFAULT=5/1m';
  mail = await startEmailStub();
  app = await buildTestApp();
});

afterAll(async () => {
  const r = await redis();
  const keys = await r.keys('rl:*');
  if (keys.length > 0) await r.del(...keys);
  await app?.close();
  await mail?.close();
});

describe('rate limits on', () => {
  it('the 4th forgot-password email to one address within the hour → 429', async () => {
    const email = uniqueEmail('cap');
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await call(app, 'POST', '/auth/forgot-password', { payload: { email } })).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it('probes are never limited (40 calls → all 200), while an ordinary route is (DEFAULT 5/min → the 6th is 429)', async () => {
    const probes = await Promise.all([...Array(40)].map((_, i) => call(app, 'GET', ['/live', '/health', '/ready'][i % 3])));
    expect(probes.filter((p) => p.status !== 200)).toHaveLength(0);
    const ordinary: number[] = [];
    for (let i = 0; i < 6; i++) ordinary.push((await call(app, 'GET', '/no-such-route')).status);
    expect(ordinary.slice(0, 5)).toEqual([404, 404, 404, 404, 404]);
    expect(ordinary[5]).toBe(429);
  });

  it('the test client was never automatically blocked', async () => {
    expect(await (await redis()).zscore('auto_blocked_ips', '127.0.0.1')).toBeNull();
  });
});
