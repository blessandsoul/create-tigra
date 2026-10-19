import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { logger } from '@libs/logger.js';
import {
  formatRequestLine,
  logRequestLine,
  requestLogFields,
  requestPath,
  shouldAttachFields,
  shouldColorize,
  type RequestLineParts,
} from '../requestLogger.js';

vi.mock('@libs/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@libs/client-ip.js', () => ({ getClientIp: (): string => '203.0.113.7' }));

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

describe('the query never reaches a request log', () => {
  it('requestPath drops the query and the fragment, keeps route params', () => {
    expect(requestPath('/api/v1/admin/users?search=jane@example.com&page=2')).toBe('/api/v1/admin/users');
    expect(requestPath('/api/v1/admin/users/0b7c/status#x')).toBe('/api/v1/admin/users/0b7c/status');
    expect(requestPath('/api/v1/auth/me')).toBe('/api/v1/auth/me');
    expect(requestPath('/?')).toBe('/');
  });

  it('the text line prints the path without the query', () => {
    const line = formatRequestLine({ ...parts, url: '/api/v1/admin/users?search=jane@example.com' }, { color: false });
    expect(line).toBe('GET    /api/v1/admin/users 200 OK (12ms) [ip=203.0.113.7 reqId=req-1]');
  });

  it('requestLogFields has exactly the six fields, with the path', () => {
    expect(requestLogFields({ ...parts, url: '/api/v1/auth/me?token=abc' })).toEqual({
      reqId: 'req-1',
      method: 'GET',
      path: '/api/v1/auth/me',
      statusCode: 200,
      durationMs: 12,
      ip: '203.0.113.7',
    });
  });
});

describe('logRequestLine', () => {
  const request = (url: string): FastifyRequest =>
    ({ method: 'GET', url, id: 'req-9', startTime: Date.now() - 5 }) as unknown as FastifyRequest;
  const reply = (statusCode: number): FastifyReply =>
    ({ statusCode, raw: { statusMessage: 'Status' } }) as unknown as FastifyReply;

  beforeEach(() => vi.clearAllMocks());

  it('fields are attached only where logs are JSON (production)', () => {
    expect(shouldAttachFields('production')).toBe(true);
    expect(shouldAttachFields('development')).toBe(false);
    expect(shouldAttachFields('test')).toBe(false);
  });

  it.each([
    [200, 'info'],
    [302, 'info'],
    [404, 'warn'],
    [503, 'error'],
  ] as const)('production: %i logs at %s with the fields and the line, no query anywhere', (status, level) => {
    logRequestLine(request('/api/v1/admin/users?search=jane@example.com'), reply(status), { color: false, fields: true });
    const call = vi.mocked(logger[level]).mock.calls[0] as unknown as [Record<string, unknown>, string];
    expect(call[0]).toMatchObject({ reqId: 'req-9', method: 'GET', path: '/api/v1/admin/users', statusCode: status, ip: '203.0.113.7' });
    expect(typeof call[0].durationMs).toBe('number');
    expect(call[1]).toMatch(new RegExp(`^GET {4}/api/v1/admin/users ${status} Status `));
    expect(JSON.stringify(call)).not.toMatch(/jane|search=|\?/);
  });

  it('development: the one line only, no field object (pino-pretty would print each field)', () => {
    logRequestLine(request('/api/v1/auth/me?x=1'), reply(200), { color: false, fields: false });
    expect(vi.mocked(logger.info).mock.calls[0]).toEqual([expect.stringMatching(/^GET {4}\/api\/v1\/auth\/me 200 /)]);
  });
});
