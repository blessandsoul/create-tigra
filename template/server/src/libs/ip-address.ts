/**
 * The one canonical spelling of an IP address. Pure (no env, no I/O), so both
 * the visitor-address code (libs/client-ip.ts, which re-exports it) and the IP
 * block list (libs/ip-block.ts) can use it: a block an admin types in must be
 * the same string as the key the visitor's requests produce.
 */
import { isIP } from 'node:net';

/**
 * Canonical form of an address so one visitor always maps to one key, and an admin's IP
 * block matches however the address was written:
 * - IPv4-mapped IPv6 (`::ffff:203.0.113.7`, or its hex spelling `::ffff:cb00:7107`)
 *   becomes plain IPv4;
 * - other IPv6 gets the one standard spelling (lower case, zeros compressed:
 *   `2001:0DB8:0000::0001` → `2001:db8::1`);
 * - an IPv6 with a zone id (`fe80::1%eth0`, link-local only) is just lower-cased.
 * Returns undefined for anything that is not an IP literal.
 */
export function normalizeIp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let ip = value.trim();
  if (ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  const family = isIP(ip);
  if (family === 0) return undefined;
  return family === 4 ? ip : canonicalIpv6(ip);
}

/** The WHATWG URL parser's IPv6 serialization, with hex IPv4-mapped turned into IPv4. */
function canonicalIpv6(ip: string): string {
  if (ip.includes('%')) return ip.toLowerCase(); // a zone id: the URL parser refuses it
  const host = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!mapped) return host;
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}
