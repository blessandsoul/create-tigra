/**
 * The proxy (src/proxy.ts): the per-request CSP, the security headers, the
 * protected-page redirect and the matcher that leaves /healthz alone.
 */
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { config, proxy } from '../proxy';

const request = (path: string, cookie?: string): NextRequest =>
  new NextRequest(`http://localhost:3000${path}`, cookie ? { headers: { cookie } } : undefined);

const directive = (csp: string | null, name: string): string =>
  (csp ?? '').split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('content security policy', () => {
  it('production: a fresh nonce per request, strict-dynamic, no eval', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const a = proxy(request('/')).headers.get('content-security-policy');
    const b = proxy(request('/')).headers.get('content-security-policy');
    const script = directive(a, 'script-src');
    expect(script).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(directive(a, 'script-src')).not.toBe(directive(b, 'script-src'));
    expect(a).toContain("frame-ancestors 'none'");
    expect(a).toContain("object-src 'none'");
    expect(directive(a, 'connect-src')).toContain('http://localhost:8000');
  });

  it("development adds 'unsafe-eval' for hot reload", () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(directive(proxy(request('/')).headers.get('content-security-policy'), 'script-src')).toContain("'unsafe-eval'");
  });

  it('every page also gets the static security headers', () => {
    const res = proxy(request('/about'));
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });
});

describe('protected pages', () => {
  it('no session marker: sent to sign-in with where they were going, still with the CSP', () => {
    const res = proxy(request('/dashboard'));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location') ?? '');
    expect(`${location.pathname}${location.search}`).toBe('/login?from=%2Fdashboard');
    expect(res.headers.get('content-security-policy')).toBeTruthy();
  });

  it('pages under a protected area are protected too', () => {
    expect(proxy(request('/admin/users')).status).toBe(307);
  });

  it('a page that only starts with the same letters is not', () => {
    for (const path of ['/administrator', '/profile-public', '/dashboards']) {
      expect(proxy(request(path)).headers.get('location')).toBeNull();
    }
  });

  it('with the session marker the visitor passes (the client refreshes an expired token)', () => {
    const res = proxy(request('/dashboard', 'auth_session=1'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('an expired access token on a protected page is dropped so the client refreshes it', () => {
    const expired = `x.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.y`;
    const res = proxy(request('/dashboard', `auth_session=1; access_token=${expired}`));
    expect(res.headers.get('set-cookie') ?? '').toMatch(/access_token=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i);
  });
});

describe('matcher', () => {
  // Next treats the matcher as a path pattern; this one is plain regex syntax.
  const runsOn = (path: string): boolean => new RegExp(`^${config.matcher[0]}$`).test(path);

  it('runs on pages, never on static assets or the health check', () => {
    expect(runsOn('/')).toBe(true);
    expect(runsOn('/dashboard')).toBe(true);
    expect(runsOn('/healthz')).toBe(false);
    expect(runsOn('/_next/static/chunk.js')).toBe(false);
    expect(runsOn('/_next/image')).toBe(false);
    expect(runsOn('/favicon.ico')).toBe(false);
  });
});
