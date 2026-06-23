import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest } from 'fastify';

// Mutable mocked env so each test can flip TRUST_CLOUDFLARE. getClientIp reads
// env.TRUST_CLOUDFLARE at call time, so mutating it between tests is sufficient.
vi.mock('@config/env.js', () => ({
  env: { TRUST_CLOUDFLARE: false },
}));

import { env } from '@config/env.js';
import { getClientIp } from '../client-ip.js';

/**
 * Build a minimal FastifyRequest stand-in carrying just the two fields
 * getClientIp reads: `headers` and `ip`.
 */
function mockRequest(
  headers: Record<string, string | string[] | undefined>,
  ip: string,
): FastifyRequest {
  return { headers, ip } as unknown as FastifyRequest;
}

describe('getClientIp', () => {
  beforeEach(() => {
    // Reset to the production-safe default before each test.
    (env as { TRUST_CLOUDFLARE: boolean }).TRUST_CLOUDFLARE = false;
  });

  describe('when TRUST_CLOUDFLARE is false (default)', () => {
    it('returns request.ip and ignores CF-Connecting-IP', () => {
      const req = mockRequest({ 'cf-connecting-ip': '203.0.113.7' }, '172.16.0.1');
      expect(getClientIp(req)).toBe('172.16.0.1');
    });

    it('returns request.ip when no CF header is present', () => {
      const req = mockRequest({}, '172.16.0.1');
      expect(getClientIp(req)).toBe('172.16.0.1');
    });
  });

  describe('when TRUST_CLOUDFLARE is true', () => {
    beforeEach(() => {
      (env as { TRUST_CLOUDFLARE: boolean }).TRUST_CLOUDFLARE = true;
    });

    it('returns the CF-Connecting-IP header value', () => {
      const req = mockRequest({ 'cf-connecting-ip': '203.0.113.7' }, '172.16.0.1');
      expect(getClientIp(req)).toBe('203.0.113.7');
    });

    it('falls back to request.ip when CF header is missing', () => {
      const req = mockRequest({}, '172.16.0.1');
      expect(getClientIp(req)).toBe('172.16.0.1');
    });

    it('falls back to request.ip when CF header is an empty string', () => {
      const req = mockRequest({ 'cf-connecting-ip': '' }, '172.16.0.1');
      expect(getClientIp(req)).toBe('172.16.0.1');
    });

    it('falls back to request.ip when CF header is an array (not a single string)', () => {
      // Duplicate headers arrive as string[]; we only trust a single string value.
      const req = mockRequest({ 'cf-connecting-ip': ['203.0.113.7', '198.51.100.2'] }, '172.16.0.1');
      expect(getClientIp(req)).toBe('172.16.0.1');
    });

    it('uses X-Forwarded-For when CF header is absent', () => {
      const req = mockRequest({ 'x-forwarded-for': '203.0.113.7' }, '172.16.0.1');
      expect(getClientIp(req)).toBe('203.0.113.7');
    });

    it('prefers a valid CF-Connecting-IP over X-Forwarded-For', () => {
      const req = mockRequest(
        { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.2' },
        '172.16.0.1',
      );
      expect(getClientIp(req)).toBe('203.0.113.7');
    });

    it('falls through an invalid CF-Connecting-IP to a valid X-Forwarded-For', () => {
      const req = mockRequest(
        { 'cf-connecting-ip': 'garbage', 'x-forwarded-for': '198.51.100.2' },
        '172.16.0.1',
      );
      expect(getClientIp(req)).toBe('198.51.100.2');
    });
  });

  describe('X-Forwarded-For fallback (grey-cloud / DNS-only)', () => {
    // XFF is consulted regardless of TRUST_CLOUDFLARE — this is the grey-cloud fix:
    // when the API is DNS-only the CF header is absent, but the real client IP is
    // still recoverable from the left-most XFF entry the reverse proxy appended.
    it('uses X-Forwarded-For even when TRUST_CLOUDFLARE is false', () => {
      const req = mockRequest({ 'x-forwarded-for': '203.0.113.7' }, '172.16.0.1');
      expect(getClientIp(req)).toBe('203.0.113.7');
    });

    it('returns the LEFT-MOST entry of a multi-hop X-Forwarded-For', () => {
      const req = mockRequest(
        { 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' },
        '172.16.0.1',
      );
      expect(getClientIp(req)).toBe('203.0.113.7');
    });

    it('trims surrounding whitespace around the left-most X-Forwarded-For entry', () => {
      const req = mockRequest({ 'x-forwarded-for': '  203.0.113.7 , 70.41.3.18' }, '172.16.0.1');
      expect(getClientIp(req)).toBe('203.0.113.7');
    });

    it('falls back to request.ip when X-Forwarded-For has no valid IP', () => {
      const req = mockRequest({ 'x-forwarded-for': 'garbage, not-an-ip' }, '172.16.0.1');
      expect(getClientIp(req)).toBe('172.16.0.1');
    });

    it('falls back to request.ip when X-Forwarded-For is an empty string', () => {
      const req = mockRequest({ 'x-forwarded-for': '' }, '172.16.0.1');
      expect(getClientIp(req)).toBe('172.16.0.1');
    });

    it('uses the first element when X-Forwarded-For arrives as an array', () => {
      const req = mockRequest({ 'x-forwarded-for': ['203.0.113.7', '198.51.100.2'] }, '172.16.0.1');
      expect(getClientIp(req)).toBe('203.0.113.7');
    });
  });

  it('always returns a non-empty string (safe as a rate-limit keyGenerator)', () => {
    (env as { TRUST_CLOUDFLARE: boolean }).TRUST_CLOUDFLARE = true;
    const withHeader = getClientIp(mockRequest({ 'cf-connecting-ip': '203.0.113.7' }, '172.16.0.1'));
    const withoutHeader = getClientIp(mockRequest({}, '172.16.0.1'));
    expect(withHeader.length).toBeGreaterThan(0);
    expect(withoutHeader.length).toBeGreaterThan(0);
  });
});
