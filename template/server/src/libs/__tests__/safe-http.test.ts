/**
 * safeHttpClient (../safe-http.ts) against a real local HTTP server. The test
 * policy allows ONLY that server's address (127.0.0.1) on top of the production
 * rules, so every other internal or special address stays forbidden, and a
 * fake resolver decides what each test hostname "resolves" to.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LookupAddress } from 'node:dns';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSafeHttpClient, safeHttpClient } from '../safe-http.js';
import { isForbiddenOutboundIp } from '../url-safety.js';
import { OutboundHttpError } from '../http.js';

vi.mock('@libs/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

let port = 0;
const hits: string[] = [];
const server = http.createServer((req, res) => {
  hits.push(req.url ?? '');
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/redirect') {
    res.writeHead(302, { location: url.searchParams.get('to') ?? '/' });
    return res.end();
  }
  if (url.pathname === '/loop') {
    res.writeHead(302, { location: '/loop' });
    return res.end();
  }
  if (url.pathname === '/big') {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    return res.end(Buffer.alloc(11 * 1024 * 1024, 1));
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
});

/** Test DNS: public.test → the local server, internal.test → 10.0.0.5, mixed.test → both. */
const resolve = async (hostname: string): Promise<LookupAddress[]> => {
  if (hostname === 'public.test') return [{ address: '127.0.0.1', family: 4 }];
  if (hostname === 'internal.test') return [{ address: '10.0.0.5', family: 4 }];
  if (hostname === 'mixed.test') return [{ address: '127.0.0.1', family: 4 }, { address: '169.254.169.254', family: 4 }];
  return [];
};
const client = createSafeHttpClient({ resolve, isForbidden: (ip) => ip !== '127.0.0.1' && isForbiddenOutboundIp(ip) });

beforeAll(async () => {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  server.close();
});

async function failure(promise: Promise<unknown>): Promise<OutboundHttpError> {
  try {
    await promise;
  } catch (error) {
    return error as OutboundHttpError;
  }
  throw new Error('expected the request to fail');
}

describe('safeHttpClient', () => {
  it('fetches a public target (a hostname whose every answer is allowed)', async () => {
    const res = await client.get(`http://public.test:${port}/ok`);
    expect(res.data).toEqual({ ok: true });
  });

  it.each([
    ['a hostname resolving to a private address', 'http://internal.test/'],
    ['a hostname where ONE answer is internal', 'http://mixed.test:PORT/ok'],
    ['loopback as an IP literal (production policy)', 'http://127.0.0.1:PORT/ok'],
    ['IPv6 loopback literal', 'http://[::1]:PORT/ok'],
    ['127.0.0.1 written as hex IPv4-mapped', 'http://[::ffff:7f00:1]:PORT/ok'],
    ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data/'],
    ['a non-http protocol', 'file:///etc/passwd'],
    ['a data: URL', 'data:text/plain,hello'],
  ])('refuses %s, before connecting', async (_label, raw) => {
    const policyClient = raw.includes('127.0.0.1') || raw.includes('[::') ? safeHttpClient : client;
    const before = hits.length;
    const error = await failure(policyClient.get(raw.replace('PORT', String(port))));
    expect(error).toBeInstanceOf(OutboundHttpError);
    expect(error.kind).toBe('blocked');
    expect(hits.length).toBe(before); // the server never saw the request
  });

  it('refuses a redirect to an internal IP literal (checked on every hop)', async () => {
    const before = hits.length;
    const error = await failure(client.get(`http://public.test:${port}/redirect?to=${encodeURIComponent('http://169.254.169.254/')}`));
    expect(error.kind).toBe('blocked');
    expect(hits.slice(before)).toEqual([`/redirect?to=${encodeURIComponent('http://169.254.169.254/')}`]);
  });

  it('refuses a redirect to a hostname that resolves internally', async () => {
    const error = await failure(client.get(`http://public.test:${port}/redirect?to=${encodeURIComponent('http://internal.test/')}`));
    expect(error.kind).toBe('blocked');
  });

  it('refuses a redirect to another protocol', async () => {
    const error = await failure(client.get(`http://public.test:${port}/redirect?to=${encodeURIComponent('file:///etc/passwd')}`));
    expect(error).toBeInstanceOf(OutboundHttpError);
  });

  it('follows at most 3 redirects', async () => {
    const before = hits.length;
    const error = await failure(client.get(`http://public.test:${port}/loop`));
    expect(error).toBeInstanceOf(OutboundHttpError);
    expect(hits.length - before).toBe(4); // the first request + 3 redirects
  });

  it('stops a response over 10 MB (kind too-large)', async () => {
    const error = await failure(client.get(`http://public.test:${port}/big`, { responseType: 'arraybuffer' }));
    expect(error.kind).toBe('too-large');
  });

  it('ignores an HTTP_PROXY from the environment (a proxy would fetch the target for us)', async () => {
    const proxyHits: string[] = [];
    const proxy = http.createServer((req, res) => {
      proxyHits.push(req.url ?? '');
      res.end('{}');
    });
    await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
    const saved = process.env.HTTP_PROXY;
    process.env.HTTP_PROXY = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    try {
      const before = hits.length;
      await client.get(`http://public.test:${port}/ok`);
      expect(proxyHits).toEqual([]);
      expect(hits.length).toBe(before + 1);
    } finally {
      if (saved === undefined) delete process.env.HTTP_PROXY;
      else process.env.HTTP_PROXY = saved;
      proxy.close();
    }
  });
});

