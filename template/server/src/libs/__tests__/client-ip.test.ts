import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest } from 'fastify';

// Mock the env module so each test can flip TRUST_CLOUDFLARE without relying on
// process.env load order (src/config/env.ts validates + exits on import).
const mockEnv = vi.hoisted(() => ({ TRUST_CLOUDFLARE: false }));
vi.mock('@config/env.js', () => ({ env: mockEnv }));

import { getClientIp } from '../client-ip.js';

// Minimal FastifyRequest stub — getClientIp only reads `.ip` and `.headers`.
function makeRequest(ip: string, headers: Record<string, unknown> = {}): FastifyRequest {
  return { ip, headers } as unknown as FastifyRequest;
}

describe('getClientIp', () => {
  beforeEach(() => {
    mockEnv.TRUST_CLOUDFLARE = false;
  });

  describe('when TRUST_CLOUDFLARE is false (default)', () => {
    it('returns request.ip and ignores the CF-Connecting-IP header', () => {
      const request = makeRequest('10.0.0.1', { 'cf-connecting-ip': '203.0.113.7' });
      expect(getClientIp(request)).toBe('10.0.0.1');
    });

    it('returns request.ip when no CF header is present', () => {
      expect(getClientIp(makeRequest('10.0.0.1'))).toBe('10.0.0.1');
    });
  });

  describe('when TRUST_CLOUDFLARE is true', () => {
    beforeEach(() => {
      mockEnv.TRUST_CLOUDFLARE = true;
    });

    it('returns the CF-Connecting-IP header value', () => {
      const request = makeRequest('10.0.0.1', { 'cf-connecting-ip': '203.0.113.7' });
      expect(getClientIp(request)).toBe('203.0.113.7');
    });

    it('falls back to request.ip when the CF header is absent', () => {
      expect(getClientIp(makeRequest('10.0.0.1'))).toBe('10.0.0.1');
    });

    it('falls back to request.ip when the CF header is an empty string', () => {
      const request = makeRequest('10.0.0.1', { 'cf-connecting-ip': '' });
      expect(getClientIp(request)).toBe('10.0.0.1');
    });

    it('falls back to request.ip when the CF header is an array (duplicated header)', () => {
      const request = makeRequest('10.0.0.1', { 'cf-connecting-ip': ['203.0.113.7', '198.51.100.2'] });
      expect(getClientIp(request)).toBe('10.0.0.1');
    });

    it('falls through an array CF header to a valid X-Forwarded-For entry', () => {
      // CF header is an array (untrusted shape) so it falls through; XFF is then used.
      const request = makeRequest('10.0.0.1', {
        'cf-connecting-ip': ['203.0.113.7', '198.51.100.2'],
        'x-forwarded-for': '198.51.100.9',
      });
      expect(getClientIp(request)).toBe('198.51.100.9');
    });

    it('prefers a valid CF header over X-Forwarded-For', () => {
      const request = makeRequest('10.0.0.1', {
        'cf-connecting-ip': '203.0.113.7',
        'x-forwarded-for': '198.51.100.9',
      });
      expect(getClientIp(request)).toBe('203.0.113.7');
    });

    it('falls through to X-Forwarded-For when the CF header is an invalid IP', () => {
      const request = makeRequest('10.0.0.1', {
        'cf-connecting-ip': 'not-an-ip',
        'x-forwarded-for': '198.51.100.9',
      });
      expect(getClientIp(request)).toBe('198.51.100.9');
    });
  });

  describe('X-Forwarded-For resolution (independent of the flag)', () => {
    it('uses the left-most XFF entry when the CF flag is on but the CF header is absent', () => {
      mockEnv.TRUST_CLOUDFLARE = true;
      const request = makeRequest('10.0.0.1', { 'x-forwarded-for': '203.0.113.7' });
      expect(getClientIp(request)).toBe('203.0.113.7');
    });

    it('uses the left-most XFF entry even when the CF flag is off (grey-cloud / DNS-only)', () => {
      const request = makeRequest('10.0.0.1', { 'x-forwarded-for': '203.0.113.7' });
      expect(getClientIp(request)).toBe('203.0.113.7');
    });

    it('returns the left-most entry of a multi-hop XFF chain', () => {
      const request = makeRequest('10.0.0.1', {
        'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178',
      });
      expect(getClientIp(request)).toBe('203.0.113.7');
    });

    it('trims surrounding whitespace from the XFF entry', () => {
      const request = makeRequest('10.0.0.1', { 'x-forwarded-for': '  203.0.113.7  , 70.41.3.18' });
      expect(getClientIp(request)).toBe('203.0.113.7');
    });

    it('falls back to request.ip when the XFF entry is not a valid IP', () => {
      const request = makeRequest('10.0.0.1', { 'x-forwarded-for': 'garbage, 70.41.3.18' });
      expect(getClientIp(request)).toBe('10.0.0.1');
    });

    it('falls back to request.ip when the XFF header is an empty string', () => {
      const request = makeRequest('10.0.0.1', { 'x-forwarded-for': '' });
      expect(getClientIp(request)).toBe('10.0.0.1');
    });

    it('uses the first element when XFF is an array (duplicated header)', () => {
      const request = makeRequest('10.0.0.1', { 'x-forwarded-for': ['203.0.113.7', '70.41.3.18'] });
      expect(getClientIp(request)).toBe('203.0.113.7');
    });
  });
});
