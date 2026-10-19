/**
 * Outbound calls from the real app (the layer 7 guarantees that need the
 * whole app): when the email provider hangs or fails, forgot-password still
 * gives the same answer, and gives it within about 10 s instead of holding the
 * request open. The outbound guard itself (internal addresses, redirects,
 * size cap, proxies, URL redaction) is pinned by safe-http.test.ts,
 * http.test.ts and url-safety.test.ts with real local servers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, call, registerUser, startEmailStub, type EmailStub } from '@/test/integration-helpers.js';

let app: FastifyInstance;
let mail: EmailStub;

beforeAll(async () => {
  mail = await startEmailStub();
  app = await buildTestApp();
});

afterAll(async () => {
  await app?.close();
  await mail?.close();
});

describe('forgot-password when the email provider misbehaves', () => {
  it('a provider that hangs: still 200, and answered in about 10 s (the send timeout), not minutes', async () => {
    const u = await registerUser(app, 'hung');
    mail.respond({ delayMs: 30_000 });
    const started = Date.now();
    const r = await call(app, 'POST', '/auth/forgot-password', { payload: { email: u.email } });
    const seconds = (Date.now() - started) / 1000;
    mail.respond({});
    expect(r.status).toBe(200);
    expect(seconds).toBeGreaterThanOrEqual(9);
    expect(seconds).toBeLessThan(15);
  }, 30_000);

  it('a provider that answers an error: still 200, the same answer as for any address', async () => {
    const u = await registerUser(app, 'failing');
    mail.respond({ status: 500 });
    const failing = await call(app, 'POST', '/auth/forgot-password', { payload: { email: u.email } });
    mail.respond({});
    const unknown = await call(app, 'POST', '/auth/forgot-password', { payload: { email: `nobody-${Date.now()}@example.test` } });
    expect(failing.status).toBe(200);
    expect(failing.body).toEqual(unknown.body);
  });
});
