import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { env } from '@config/env.js';
import { logger } from '@libs/logger.js';
import {
  normalizeIp,
  resolveClientIp,
  getClientIp,
  TRUSTED_PROXY_RANGES,
  UNVERIFIED_CLOUDFLARE_KEY,
  UNVERIFIED_WARNING_INTERVAL_MS,
  resetUnverifiedWarningForTests,
} from '../client-ip.js';

// Real Fastify with the app's own trustProxy setting, so proxy-addr walks X-Forwarded-For exactly
// as in production. `remoteAddress` is the TCP peer: a public address = a direct visitor,
// 10.0.1.5 = Coolify's Traefik on the Docker network, 173.245.48.10 = a Cloudflare edge server.
const TRAEFIK = '10.0.1.5';
const CF_EDGE = '173.245.48.10';
const CF_EDGE_V6 = '2400:cb00::1';
const VISITOR = '203.0.113.7';
const OTHER_VISITOR = '198.51.100.20';
const FORGED = '6.6.6.6';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ trustProxy: TRUSTED_PROXY_RANGES });
  app.get('/ip', async (request) => ({ ...resolveClientIp(request), key: getClientIp(request) }));
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function resolve(remoteAddress: string, headers: Record<string, string | string[]> = {}): Promise<{ ip: string; source: string; key: string }> {
  const res = await app.inject({ method: 'GET', url: '/ip', remoteAddress, headers });
  return res.json();
}

describe('resolveClientIp — a visitor that reaches the app directly (no trusted proxy)', () => {
  it('uses the TCP peer', async () => {
    expect(await resolve(VISITOR)).toEqual({ ip: VISITOR, source: 'socket', key: VISITOR });
  });

  it('ignores X-Forwarded-For and CF-Connecting-IP written by that visitor', async () => {
    const r = await resolve(VISITOR, { 'x-forwarded-for': FORGED, 'cf-connecting-ip': OTHER_VISITOR });
    expect(r).toMatchObject({ ip: VISITOR, source: 'socket' });
  });
});

describe('resolveClientIp — behind our own proxy (Traefik), no Cloudflare', () => {
  it('uses the address the proxy recorded', async () => {
    expect(await resolve(TRAEFIK, { 'x-forwarded-for': VISITOR })).toMatchObject({ ip: VISITOR, source: 'proxy' });
  });

  it('ignores entries the visitor wrote to the left of it (the old spoofing hole)', async () => {
    const r = await resolve(TRAEFIK, { 'x-forwarded-for': `${FORGED}, 10.0.0.9, ${VISITOR}` });
    expect(r).toMatchObject({ ip: VISITOR, source: 'proxy' });
  });

  it('ignores a forged CF-Connecting-IP when the hop is not Cloudflare (sslip.io, grey cloud, server IP)', async () => {
    const r = await resolve(TRAEFIK, { 'x-forwarded-for': VISITOR, 'cf-connecting-ip': FORGED });
    expect(r).toMatchObject({ ip: VISITOR, source: 'proxy' });
  });

  it('skips further trusted internal hops to the right', async () => {
    const r = await resolve(TRAEFIK, { 'x-forwarded-for': `${VISITOR}, 10.0.0.9` });
    expect(r).toMatchObject({ ip: VISITOR, source: 'proxy' });
  });

  it('gives two visitors two different keys (no shared counter through one proxy)', async () => {
    const a = await resolve(TRAEFIK, { 'x-forwarded-for': VISITOR });
    const b = await resolve(TRAEFIK, { 'x-forwarded-for': OTHER_VISITOR });
    expect(a.key).not.toBe(b.key);
  });

  it('falls back to the proxy address when the proxy sent no X-Forwarded-For', async () => {
    expect(await resolve(TRAEFIK)).toMatchObject({ ip: TRAEFIK, source: 'socket' });
    expect(await resolve(TRAEFIK, { 'x-forwarded-for': '' })).toMatchObject({ ip: TRAEFIK });
  });
});

describe('resolveClientIp — through Cloudflare', () => {
  it('Cloudflare then our proxy: uses CF-Connecting-IP, never the edge address', async () => {
    const r = await resolve(TRAEFIK, { 'x-forwarded-for': `${FORGED}, ${OTHER_VISITOR}, ${CF_EDGE}`, 'cf-connecting-ip': OTHER_VISITOR });
    expect(r).toEqual({ ip: OTHER_VISITOR, source: 'cloudflare', key: OTHER_VISITOR });
  });

  it('two visitors behind the same Cloudflare edge get two keys (the old shared lockout)', async () => {
    const a = await resolve(TRAEFIK, { 'x-forwarded-for': `${VISITOR}, ${CF_EDGE}`, 'cf-connecting-ip': VISITOR });
    const b = await resolve(TRAEFIK, { 'x-forwarded-for': `${OTHER_VISITOR}, ${CF_EDGE}`, 'cf-connecting-ip': OTHER_VISITOR });
    expect([a.key, b.key]).toEqual([VISITOR, OTHER_VISITOR]);
  });

  it('Cloudflare connecting to the app directly also works', async () => {
    expect(await resolve(CF_EDGE, { 'cf-connecting-ip': VISITOR })).toMatchObject({ ip: VISITOR, source: 'cloudflare' });
  });

  it('works for an IPv6 edge and an IPv6 visitor', async () => {
    const r = await resolve(TRAEFIK, { 'x-forwarded-for': `2001:db8::5, ${CF_EDGE_V6}`, 'cf-connecting-ip': '2001:DB8::5' });
    expect(r).toMatchObject({ ip: '2001:db8::5', source: 'cloudflare' });
  });

  it('a Cloudflare hop with a missing or invalid header stays on the edge address (strict, not spoofable)', async () => {
    const variants: Record<string, string | string[]>[] = [{}, { 'cf-connecting-ip': '' }, { 'cf-connecting-ip': 'not-an-ip' }, { 'cf-connecting-ip': [VISITOR, FORGED] }];
    for (const headers of variants) {
      const r = await resolve(TRAEFIK, { 'x-forwarded-for': CF_EDGE, ...headers });
      expect(r.ip).toBe(CF_EDGE);
    }
  });
});

describe('resolveClientIp — Cloudflare requests that are not genuine traffic of this zone', () => {
  // A Cloudflare Worker (anyone's) fetching the app through a non-Cloudflare hostname leaves from
  // Cloudflare's ranges and may set CF-Connecting-IP freely; Cloudflare stamps such requests with
  // CF-Worker. They must land in one fixed bucket, whatever address they claim.
  it('without a secret: a CF-Worker-stamped request is unverified and keyed on one fixed bucket', async () => {
    const a = await resolve(TRAEFIK, { 'x-forwarded-for': CF_EDGE, 'cf-connecting-ip': FORGED, 'cf-worker': 'attacker.example' });
    const b = await resolve(TRAEFIK, { 'x-forwarded-for': '104.16.0.9', 'cf-connecting-ip': OTHER_VISITOR, 'cf-worker': 'x' });
    expect(a).toEqual({ ip: UNVERIFIED_CLOUDFLARE_KEY, source: 'cloudflare-unverified', key: UNVERIFIED_CLOUDFLARE_KEY });
    expect(b.key).toBe(a.key);
  });

  describe('with CLOUDFLARE_ORIGIN_SECRET set', () => {
    const SECRET = 'a'.repeat(40);
    beforeAll(() => {
      env.CLOUDFLARE_ORIGIN_SECRET = SECRET;
    });
    afterAll(() => {
      env.CLOUDFLARE_ORIGIN_SECRET = undefined;
    });

    it('believes CF-Connecting-IP only with the matching origin secret', async () => {
      const ok = await resolve(TRAEFIK, { 'x-forwarded-for': CF_EDGE, 'cf-connecting-ip': VISITOR, 'x-origin-verify': SECRET });
      expect(ok).toMatchObject({ ip: VISITOR, source: 'cloudflare' });
    });

    it('a missing, wrong, wrong-length or repeated secret is unverified (fixed bucket)', async () => {
      const variants: Record<string, string | string[]>[] = [
        {},
        { 'x-origin-verify': 'b'.repeat(40) },
        { 'x-origin-verify': 'short' },
        { 'x-origin-verify': [SECRET, SECRET] },
      ];
      for (const extra of variants) {
        const r = await resolve(TRAEFIK, { 'x-forwarded-for': CF_EDGE, 'cf-connecting-ip': FORGED, ...extra });
        expect(r).toMatchObject({ ip: UNVERIFIED_CLOUDFLARE_KEY, source: 'cloudflare-unverified' });
      }
    });

    it('the owner\'s own zone traffic is believed even when stamped by one of the owner\'s Workers', async () => {
      const r = await resolve(TRAEFIK, { 'x-forwarded-for': CF_EDGE, 'cf-connecting-ip': VISITOR, 'x-origin-verify': SECRET, 'cf-worker': 'owner.example' });
      expect(r).toMatchObject({ ip: VISITOR, source: 'cloudflare' });
    });

    it('a non-Cloudflare hop never uses CF-Connecting-IP, secret or not', async () => {
      const r = await resolve(TRAEFIK, { 'x-forwarded-for': VISITOR, 'cf-connecting-ip': FORGED, 'x-origin-verify': SECRET });
      expect(r).toMatchObject({ ip: VISITOR, source: 'proxy' });
    });
  });
});

describe('resolveClientIp — address forms and broken input', () => {
  it('normalizes IPv4-mapped IPv6 and upper-case IPv6 so one visitor has one key', async () => {
    expect(await resolve(`::ffff:${VISITOR}`)).toMatchObject({ ip: VISITOR, source: 'socket' });
    expect(await resolve(TRAEFIK, { 'x-forwarded-for': '2001:DB8::1' })).toMatchObject({ ip: '2001:db8::1' });
  });

  it('treats an IPv4-mapped proxy address as our proxy', async () => {
    expect(await resolve(`::ffff:${TRAEFIK}`, { 'x-forwarded-for': VISITOR })).toMatchObject({ ip: VISITOR, source: 'proxy' });
  });

  it('several X-Forwarded-For headers are read as one list, right-most first', async () => {
    const r = await resolve(TRAEFIK, { 'x-forwarded-for': [FORGED, VISITOR] });
    expect(r.ip).toBe(VISITOR);
  });

  it('always returns a non-empty key, whatever the headers contain', async () => {
    for (const xff of ['garbage', ',,,', ' , 999.1.1.1', `${VISITOR}, garbage`]) {
      const r = await resolve(TRAEFIK, { 'x-forwarded-for': xff });
      expect(r.key.length).toBeGreaterThan(0);
    }
  });
});

describe('normalizeIp', () => {
  it('accepts IPv4/IPv6 literals and rejects everything else', () => {
    expect(normalizeIp(' 203.0.113.7 ')).toBe('203.0.113.7');
    expect(normalizeIp('::FFFF:203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeIp('2001:DB8::1')).toBe('2001:db8::1');
    expect(normalizeIp('::ffff:not-ip')).toBeUndefined();
    expect(normalizeIp('')).toBeUndefined();
    expect(normalizeIp(undefined)).toBeUndefined();
    expect(normalizeIp('example.com')).toBeUndefined();
  });

  it('gives every spelling of one address the same canonical form', () => {
    expect(normalizeIp('2001:0DB8:0000::0001')).toBe('2001:db8::1');
    expect(normalizeIp('2001:db8:0:0:0:0:0:1')).toBe('2001:db8::1');
    expect(normalizeIp('::ffff:cb00:7107')).toBe('203.0.113.7'); // hex IPv4-mapped
    expect(normalizeIp('::1')).toBe('::1');
    expect(normalizeIp('FE80::1%ETH0')).toBe('fe80::1%eth0'); // zone id: lower-cased only
  });
});

describe('TRUST_CLOUDFLARE is gone', () => {
  it('a leftover TRUST_CLOUDFLARE value is ignored by the env schema', async () => {
    vi.resetModules();
    process.env.TRUST_CLOUDFLARE = 'true';
    try {
      const { env } = await import('@config/env.js');
      expect('TRUST_CLOUDFLARE' in env).toBe(false);
    } finally {
      delete process.env.TRUST_CLOUDFLARE;
    }
  });
});

describe('warning when Cloudflare traffic lands in the shared bucket', () => {
  // On a correctly set up zone this never happens, so the operator must hear about it:
  // every such visitor shares ONE rate-limit counter.
  const unverified = { 'x-forwarded-for': CF_EDGE, 'cf-connecting-ip': FORGED, 'cf-worker': 'someone.example' };

  afterAll(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('logs one warning per interval, not one per request, and never the header values', async () => {
    resetUnverifiedWarningForTests();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T10:00:00Z'));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);

    for (let i = 0; i < 5; i++) await resolve(TRAEFIK, unverified);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('share one rate-limit bucket');
    expect(message).not.toContain(FORGED);
    expect(message).not.toContain('someone.example');

    vi.setSystemTime(new Date(Date.now() + UNVERIFIED_WARNING_INTERVAL_MS + 1));
    await resolve(TRAEFIK, unverified);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('does not warn for verified Cloudflare traffic or for direct visitors', async () => {
    resetUnverifiedWarningForTests();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    warn.mockClear();
    await resolve(TRAEFIK, { 'x-forwarded-for': CF_EDGE, 'cf-connecting-ip': VISITOR });
    await resolve(VISITOR);
    expect(warn).not.toHaveBeenCalled();
  });
});
