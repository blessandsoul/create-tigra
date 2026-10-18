/**
 * Cloudflare edge address ranges — the proof that a request really came through Cloudflare.
 *
 * `CF-Connecting-IP` names the real visitor, but it is just a header: anyone who reaches the
 * server WITHOUT going through Cloudflare (the server's own IP, a sslip.io address, a grey-cloud
 * domain) can send it with any value. So it is believed only when the machine that handed the
 * request to our proxy is one of Cloudflare's own edge servers, i.e. its address is in these
 * ranges (see client-ip.ts).
 *
 * The ranges are bundled so the check works offline and at the first request. Cloudflare
 * changes them rarely; a background job (jobs/refresh-cloudflare-ranges.job.ts) refreshes them
 * daily from the published lists. A refresh that fails, or returns something that does not look
 * like the real list, keeps the current ranges: being out of date only means visitors behind a
 * brand-new Cloudflare range are counted under that edge's address (strict, never spoofable).
 *
 * Source of the bundled list: https://www.cloudflare.com/ips-v4 and /ips-v6, fetched 2026-10-18.
 */
import { BlockList, isIP } from 'node:net';
import { httpClient } from '@libs/http.js';
import { logger } from '@libs/logger.js';

export const CLOUDFLARE_IPV4_URL = 'https://www.cloudflare.com/ips-v4';
export const CLOUDFLARE_IPV6_URL = 'https://www.cloudflare.com/ips-v6';

export const BUNDLED_CLOUDFLARE_IPV4 = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
] as const;

export const BUNDLED_CLOUDFLARE_IPV6 = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
] as const;

// A downloaded list smaller than this is treated as broken (an error page, a truncated
// body) rather than as "Cloudflare shrank to two ranges overnight".
const MIN_IPV4_RANGES = 5;
const MIN_IPV6_RANGES = 1;

/** Parse one `address/prefix` line into a validated CIDR, or null when it is not one. */
function parseCidr(line: string, family: 4 | 6): { address: string; prefix: number } | null {
  const [address, prefixText, extra] = line.trim().split('/');
  if (!address || prefixText === undefined || extra !== undefined || isIP(address) !== family) return null;
  if (!/^\d{1,3}$/.test(prefixText)) return null;
  const prefix = Number(prefixText);
  if (prefix < 0 || prefix > (family === 4 ? 32 : 128)) return null;
  return { address, prefix };
}

/**
 * Build a BlockList from both lists, or return null when either list is not a plausible copy
 * of Cloudflare's (any unparseable line, or fewer ranges than the minimum).
 */
export function buildRangeList(ipv4: readonly string[], ipv6: readonly string[]): BlockList | null {
  const v4 = ipv4.map((l) => l.trim()).filter(Boolean);
  const v6 = ipv6.map((l) => l.trim()).filter(Boolean);
  if (v4.length < MIN_IPV4_RANGES || v6.length < MIN_IPV6_RANGES) return null;
  const list = new BlockList();
  for (const [lines, family] of [[v4, 4], [v6, 6]] as const) {
    for (const line of lines) {
      const cidr = parseCidr(line, family);
      if (!cidr) return null;
      list.addSubnet(cidr.address, cidr.prefix, family === 4 ? 'ipv4' : 'ipv6');
    }
  }
  return list;
}

// Invariant: always a valid list; the bundled one cannot fail to build (unit-tested).
let current: BlockList = buildRangeList(BUNDLED_CLOUDFLARE_IPV4, BUNDLED_CLOUDFLARE_IPV6) as BlockList;

/** True when `ip` (an already-normalized IPv4 or IPv6 literal) belongs to Cloudflare's edge. */
export function isCloudflareIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return false;
  return current.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Download the published lists and swap them in only when both look complete. Never throws:
 * a refresh is an optimisation, and the bundled ranges stay valid if it fails.
 *
 * @returns true when the ranges were replaced
 */
export async function refreshCloudflareRanges(): Promise<boolean> {
  try {
    const fetchList = async (url: string): Promise<string[]> => {
      const res = await httpClient.get<string>(url, {
        timeout: 10_000,
        responseType: 'text',
        headers: { Accept: 'text/plain' },
        // Keep the raw text: axios would otherwise try to JSON-parse it.
        transformResponse: [(data: unknown): unknown => data],
      });
      return typeof res.data === 'string' ? res.data.split(/\r?\n/) : [];
    };
    const [ipv4, ipv6] = await Promise.all([fetchList(CLOUDFLARE_IPV4_URL), fetchList(CLOUDFLARE_IPV6_URL)]);
    const next = buildRangeList(ipv4, ipv6);
    if (!next) {
      logger.warn('[CLOUDFLARE] Downloaded IP ranges look incomplete; keeping the current list');
      return false;
    }
    current = next;
    return true;
  } catch (error) {
    logger.warn({ err: error }, '[CLOUDFLARE] Could not refresh IP ranges; keeping the current list');
    return false;
  }
}

/** Test hook: return to the bundled ranges. */
export function resetCloudflareRangesForTests(): void {
  current = buildRangeList(BUNDLED_CLOUDFLARE_IPV4, BUNDLED_CLOUDFLARE_IPV6) as BlockList;
}
