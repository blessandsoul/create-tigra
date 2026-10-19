import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply } from 'fastify';
import { setAuthCookies, clearAuthCookies, resetPlainHttpWarningForTests } from '../cookies.js';
import { logger } from '@libs/logger.js';

// Production cross-subdomain setup: only the non-secret auth_session indicator
// may use COOKIE_DOMAIN; the bearer token cookies must stay host-only.

vi.mock('@config/env.js', () => ({
  env: {
    NODE_ENV: 'production',
    COOKIE_DOMAIN: '.example.test',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
  },
}));

vi.mock('@libs/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

type CookieOpts = { domain?: string; path?: string; httpOnly?: boolean; secure?: boolean; sameSite?: string };

function fakeReply(): { reply: FastifyReply; set: Map<string, CookieOpts>; cleared: Array<[string, CookieOpts]> } {
  const set = new Map<string, CookieOpts>();
  const cleared: Array<[string, CookieOpts]> = [];
  const reply = {
    setCookie: vi.fn((name: string, _value: string, opts: CookieOpts) => set.set(name, opts)),
    clearCookie: vi.fn((name: string, opts: CookieOpts) => cleared.push([name, opts])),
  } as unknown as FastifyReply;
  return { reply, set, cleared };
}

describe('setAuthCookies', () => {
  it('keeps access and refresh tokens host-only and shares only auth_session', () => {
    const { reply, set } = fakeReply();
    setAuthCookies(reply, 'access', 'refresh');

    expect(set.get('access_token')?.domain).toBeUndefined();
    expect(set.get('refresh_token')?.domain).toBeUndefined();
    expect(set.get('access_token')?.httpOnly).toBe(true);
    expect(set.get('access_token')?.secure).toBe(true);
    expect(set.get('auth_session')?.domain).toBe('.example.test');
  });

  it('expires legacy domain-wide token cookies from older versions', () => {
    const { reply, cleared } = fakeReply();
    setAuthCookies(reply, 'access', 'refresh');

    expect(cleared).toContainEqual(['access_token', expect.objectContaining({ domain: '.example.test', path: '/' })]);
    expect(cleared).toContainEqual([
      'refresh_token',
      expect.objectContaining({ domain: '.example.test', path: '/api/v1/auth' }),
    ]);
  });
});

describe('SameSite (never None, even with COOKIE_DOMAIN in production)', () => {
  it('sets the token cookies Strict and the auth_session marker Lax', () => {
    const { reply, set } = fakeReply();
    setAuthCookies(reply, 'access', 'refresh');

    expect(set.get('access_token')?.sameSite).toBe('strict');
    expect(set.get('refresh_token')?.sameSite).toBe('strict');
    expect(set.get('auth_session')?.sameSite).toBe('lax');
  });

  it('clears with the same policies, and nothing anywhere is None', () => {
    const { reply, set, cleared } = fakeReply();
    setAuthCookies(reply, 'access', 'refresh');
    clearAuthCookies(reply);

    for (const [name, opts] of cleared) {
      expect(opts.sameSite, name).toBe(name === 'auth_session' ? 'lax' : 'strict');
    }
    expect([...set.values(), ...cleared.map(([, o]) => o)].some((o) => o.sameSite === 'none')).toBe(false);
  });
});

describe('clearAuthCookies', () => {
  it('clears both the host-only tokens and any legacy domain-wide copies', () => {
    const { reply, cleared } = fakeReply();
    clearAuthCookies(reply);

    const tokenClears = cleared.filter(([name]) => name === 'access_token');
    expect(tokenClears.map(([, o]) => o.domain).sort()).toEqual(['.example.test', undefined].sort());
    expect(cleared).toContainEqual(['auth_session', expect.objectContaining({ domain: '.example.test' })]);
  });
});

describe('plain-http warning (production cookies are Secure)', () => {
  function replyOver(protocol: string, hostname = 'api.example.test'): FastifyReply {
    const { reply } = fakeReply();
    (reply as unknown as { request: unknown }).request = { protocol, hostname };
    return reply;
  }

  it('warns once when the API is reached over http', () => {
    resetPlainHttpWarningForTests();
    vi.mocked(logger.warn).mockClear();
    setAuthCookies(replyOver('http'), 'a', 'r');
    setAuthCookies(replyOver('http'), 'a', 'r');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.warn).mock.calls[0]?.[0]).toContain('plain http');
  });

  it('stays quiet over https, on localhost, and when the request is unknown', () => {
    resetPlainHttpWarningForTests();
    vi.mocked(logger.warn).mockClear();
    setAuthCookies(replyOver('https'), 'a', 'r');
    setAuthCookies(replyOver('http', 'localhost'), 'a', 'r');
    setAuthCookies(fakeReply().reply, 'a', 'r');
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
