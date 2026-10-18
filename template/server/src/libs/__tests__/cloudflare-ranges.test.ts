import { describe, it, expect, vi, beforeEach } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@libs/http.js', () => ({ httpClient: { get } }));
vi.mock('@libs/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import {
  BUNDLED_CLOUDFLARE_IPV4,
  BUNDLED_CLOUDFLARE_IPV6,
  CLOUDFLARE_IPV4_URL,
  buildRangeList,
  isCloudflareIp,
  refreshCloudflareRanges,
  resetCloudflareRangesForTests,
} from '../cloudflare-ranges.js';

/** Make the mocked HTTP client answer the two list URLs with these bodies. */
function serve(ipv4: string, ipv6: string): void {
  get.mockImplementation(async (url: string) => ({ data: url === CLOUDFLARE_IPV4_URL ? ipv4 : ipv6 }));
}

const NEW_V4 = ['192.0.2.0/24', '198.18.0.0/15', '100.64.0.0/10', '233.252.0.0/24', '240.0.0.0/8'].join('\n');
const NEW_V6 = '2001:db8:cf::/48';

beforeEach(() => {
  get.mockReset();
  resetCloudflareRangesForTests();
});

describe('bundled ranges', () => {
  it('build without error and recognise Cloudflare edges, IPv4 and IPv6', () => {
    expect(buildRangeList(BUNDLED_CLOUDFLARE_IPV4, BUNDLED_CLOUDFLARE_IPV6)).not.toBeNull();
    expect(isCloudflareIp('173.245.48.10')).toBe(true);
    expect(isCloudflareIp('104.16.1.1')).toBe(true);
    expect(isCloudflareIp('2606:4700::1')).toBe(true);
  });

  it('do not contain ordinary, private or malformed addresses', () => {
    for (const ip of ['8.8.8.8', '203.0.113.7', '10.0.1.5', '172.20.0.1', '::1', '2001:db8::1', 'garbage', '']) {
      expect(isCloudflareIp(ip)).toBe(false);
    }
  });
});

describe('refreshCloudflareRanges', () => {
  it('swaps in a complete downloaded list', async () => {
    serve(NEW_V4, NEW_V6);
    expect(await refreshCloudflareRanges()).toBe(true);
    expect(isCloudflareIp('192.0.2.10')).toBe(true);
    expect(isCloudflareIp('2001:db8:cf::1')).toBe(true);
    expect(isCloudflareIp('173.245.48.10')).toBe(false);
  });

  it('keeps the current list when the download fails', async () => {
    get.mockRejectedValue(new Error('network down'));
    expect(await refreshCloudflareRanges()).toBe(false);
    expect(isCloudflareIp('173.245.48.10')).toBe(true);
  });

  it('keeps the current list for an error page, a truncated list or a bad line', async () => {
    for (const [v4, v6] of [
      ['<html>rate limited</html>', NEW_V6],
      ['192.0.2.0/24\n198.18.0.0/15', NEW_V6],
      [`${NEW_V4}\n300.1.1.0/24`, NEW_V6],
      [NEW_V4, ''],
      [NEW_V4, '2001:db8::/200'],
    ]) {
      serve(v4, v6);
      expect(await refreshCloudflareRanges()).toBe(false);
      expect(isCloudflareIp('173.245.48.10')).toBe(true);
    }
  });

  it('tolerates Windows line endings and blank lines', async () => {
    serve(`${NEW_V4.replace(/\n/g, '\r\n')}\r\n\r\n`, `${NEW_V6}\n`);
    expect(await refreshCloudflareRanges()).toBe(true);
    expect(isCloudflareIp('100.64.0.1')).toBe(true);
  });
});
