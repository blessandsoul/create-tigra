import { describe, it, expect } from 'vitest';
import { formatRequestLine, shouldColorize, type RequestLineParts } from '../requestLogger.js';

// ESC (0x1b) starts every ANSI colour code. Production JSON logs must never contain it.
const ESC = '\x1b';

const parts: RequestLineParts = {
  method: 'GET',
  url: '/api/v1/auth/me',
  statusCode: 200,
  statusMessage: 'OK',
  durationMs: 12,
  clientIp: '203.0.113.7',
  requestId: 'req-1',
};

describe('shouldColorize', () => {
  it('colours only a real terminal outside production', () => {
    expect(shouldColorize(true, 'development')).toBe(true);
    expect(shouldColorize(true, 'test')).toBe(true);
  });

  it('never colours production, even on a terminal', () => {
    expect(shouldColorize(true, 'production')).toBe(false);
  });

  it('never colours a pipe or file (no TTY), e.g. a container log', () => {
    expect(shouldColorize(false, 'development')).toBe(false);
    expect(shouldColorize(undefined, 'development')).toBe(false);
  });
});

describe('formatRequestLine', () => {
  it('writes a plain line without colours', () => {
    const line = formatRequestLine(parts, { color: false });
    expect(line).toBe('GET    /api/v1/auth/me 200 OK (12ms) [ip=203.0.113.7 reqId=req-1]');
    expect(line).not.toContain(ESC);
  });

  it('stays plain for every status class and unknown methods', () => {
    for (const statusCode of [200, 302, 404, 500]) {
      for (const method of ['GET', 'POST', 'DELETE', 'PROPFIND']) {
        expect(formatRequestLine({ ...parts, method, statusCode }, { color: false })).not.toContain(ESC);
      }
    }
  });

  it('adds colours when asked, around the same text', () => {
    const line = formatRequestLine(parts, { color: true });
    expect(line).toContain(`${ESC}[34m`); // GET is blue
    expect(line).toContain(`${ESC}[32m200 OK`); // 2xx is green
    expect(line.replace(new RegExp(`${ESC}\\[\\d+m`, 'g'), '')).toBe(formatRequestLine(parts, { color: false }));
  });
});
