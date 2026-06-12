import { describe, it, expect } from 'vitest';
import { isOriginAllowed } from '../origin-check.js';

describe('isOriginAllowed', () => {
  const allowed = new Set(['https://app.example.com', 'https://admin.example.com']);

  it('should allow requests without an Origin header (curl, Postman, server-to-server)', () => {
    expect(isOriginAllowed(undefined, 'api.example.com', allowed, false)).toBe(true);
  });

  it('should allow any origin when CORS allows all origins (development)', () => {
    expect(isOriginAllowed('https://evil.example.org', 'api.example.com', allowed, true)).toBe(true);
  });

  it('should allow a configured CORS origin', () => {
    expect(isOriginAllowed('https://app.example.com', 'api.example.com', allowed, false)).toBe(true);
    expect(isOriginAllowed('https://admin.example.com', 'api.example.com', allowed, false)).toBe(true);
  });

  it('should allow same-origin requests (Origin host matches request Host)', () => {
    expect(isOriginAllowed('https://api.example.com', 'api.example.com', allowed, false)).toBe(true);
  });

  it('should allow same-origin requests with a port in the host', () => {
    expect(isOriginAllowed('http://localhost:8000', 'localhost:8000', new Set(), false)).toBe(true);
  });

  it('should allow same-origin requests with a mixed-case Host header', () => {
    expect(isOriginAllowed('https://api.example.com', 'API.Example.COM', allowed, false)).toBe(true);
  });

  it('should reject a cross-site origin that is not configured', () => {
    expect(isOriginAllowed('https://evil.example.org', 'api.example.com', allowed, false)).toBe(false);
  });

  it('should reject a subdomain lookalike of an allowed origin', () => {
    expect(
      isOriginAllowed('https://app.example.com.evil.org', 'api.example.com', allowed, false),
    ).toBe(false);
  });

  it('should reject a malformed Origin header', () => {
    expect(isOriginAllowed('not a url', 'api.example.com', allowed, false)).toBe(false);
  });

  it('should reject "null" origin (sandboxed iframe, data: URL)', () => {
    expect(isOriginAllowed('null', 'api.example.com', allowed, false)).toBe(false);
  });

  it('should reject an unknown origin when the request host is unavailable', () => {
    expect(isOriginAllowed('https://evil.example.org', undefined, allowed, false)).toBe(false);
  });
});
