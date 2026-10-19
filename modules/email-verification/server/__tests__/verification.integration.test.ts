/**
 * Email verification (the email-verification module) against a real MySQL
 * and Redis, with verification switched ON for this file. Emails go to an
 * in-process Resend stub; nothing is sent.
 * - Register does not sign in; signing in before verifying is refused
 *   (403 EMAIL_NOT_VERIFIED).
 * - The emailed link verifies once and signs in; the same link again, or any
 *   other token, is 400 INVALID_VERIFICATION_TOKEN.
 * - Verification tokens are stored by fingerprint only: no Redis key or value
 *   holds the raw token.
 * - send-verification answers the same for every address (no account
 *   discovery) and emails a fresh link only to an unverified account.
 *
 * The generator copies this file into server/src/modules/auth/__tests__/
 * (lib/patchers/email-verification.patcher.js); it runs with the rest of the
 * integration suite.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  PASSWORD,
  buildTestApp,
  call,
  CookieJar,
  redis,
  startEmailStub,
  tokenOf,
  uniqueEmail,
  type EmailStub,
} from '@/test/integration-helpers.js';

let app: FastifyInstance;
let mail: EmailStub;

beforeAll(async () => {
  process.env.REQUIRE_USER_VERIFICATION = 'true';
  mail = await startEmailStub();
  app = await buildTestApp();
});

afterAll(async () => {
  await app?.close();
  await mail?.close();
});

/** Registers an address and returns the raw token of the verification link it was emailed. */
async function registerUnverified(tag: string): Promise<{ email: string; token: string; registerJar: CookieJar }> {
  const email = uniqueEmail(tag);
  const registerJar = new CookieJar();
  const r = await call(app, 'POST', '/auth/register', {
    jar: registerJar,
    payload: { email, password: PASSWORD, firstName: 'Veri', lastName: 'Fied' },
  });
  expect(r.status).toBe(201);
  // The verification email goes out after register has answered: wait for it.
  const sent = await mail.waitFor(email, (e) => /verify-account/.test(e.link ?? ''));
  return { email, token: tokenOf(sent.at(-1)?.link ?? null), registerJar };
}

describe('before verifying', () => {
  it('register answers 201 without signing in, and sign-in is refused with 403 EMAIL_NOT_VERIFIED', async () => {
    const { email, registerJar } = await registerUnverified('unverified');
    expect(registerJar.get('access_token')).toBeUndefined();
    const login = await call(app, 'POST', '/auth/login', { payload: { email, password: PASSWORD } });
    expect([login.status, login.code]).toEqual([403, 'EMAIL_NOT_VERIFIED']);
  });
});

describe('the verification link', () => {
  it('verifies once and signs in; the same link again is 400 INVALID_VERIFICATION_TOKEN', async () => {
    const { token } = await registerUnverified('verify');
    const jar = new CookieJar();
    const ok = await call(app, 'POST', '/auth/verify-account', { jar, payload: { token } });
    expect(ok.status).toBe(200);
    expect((await call(app, 'GET', '/auth/me', { jar })).status).toBe(200);
    const again = await call(app, 'POST', '/auth/verify-account', { payload: { token } });
    expect([again.status, again.code]).toEqual([400, 'INVALID_VERIFICATION_TOKEN']);
  });

  it('a token nobody was sent → 400 INVALID_VERIFICATION_TOKEN', async () => {
    const r = await call(app, 'POST', '/auth/verify-account', { payload: { token: 'f'.repeat(64) } });
    expect([r.status, r.code]).toEqual([400, 'INVALID_VERIFICATION_TOKEN']);
  });

  it('no Redis key or value holds the raw token (stored by fingerprint only)', async () => {
    const { token } = await registerUnverified('fingerprint');
    const r = await redis();
    const keys = await r.keys('verify*');
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.join('\n')).not.toContain(token);
    for (const key of keys) {
      if ((await r.type(key)) === 'string') expect((await r.get(key)) ?? '').not.toContain(token);
    }
  });
});

describe('send-verification', () => {
  it('answers the same for an unknown address and an unverified account; only the account gets a new link', async () => {
    const { email } = await registerUnverified('resend');
    const before = mail.to(email).length;
    const known = await call(app, 'POST', '/auth/send-verification', { payload: { email } });
    const unknownEmail = uniqueEmail('nobody');
    const unknown = await call(app, 'POST', '/auth/send-verification', { payload: { email: unknownEmail } });
    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(await mail.waitFor(email, () => true, before + 1)).toHaveLength(before + 1);
    expect(mail.to(unknownEmail)).toHaveLength(0);
  });

  it('wrong input → 422 VALIDATION_FAILED (send-verification and verify-account)', async () => {
    const a = await call(app, 'POST', '/auth/send-verification', { payload: { email: 'x' } });
    const b = await call(app, 'POST', '/auth/verify-account', { payload: {} });
    expect([a.status, a.code, b.status, b.code]).toEqual([422, 'VALIDATION_FAILED', 422, 'VALIDATION_FAILED']);
  });
});
