/**
 * URL/IP safety helpers for outbound HTTP and IP blocking.
 *
 *  - `redactUrl`             strips secrets (credentials in the URL, query
 *                            strings, Telegram bot tokens) before a URL reaches
 *                            any log sink.
 *  - `isPrivateOrReservedIp` internal infrastructure: loopback, private,
 *                            link-local, CGNAT, unique-local, unspecified. Used
 *                            by IP blocking (never block or auto-block these).
 *  - `isForbiddenOutboundIp` everything that is not a public unicast address
 *                            (the above plus multicast, reserved, documentation,
 *                            NAT64/6to4 and similar). Used ONLY by the guarded
 *                            client for user-supplied URLs (libs/safe-http.ts).
 *
 * Two lists on purpose: documentation ranges such as 203.0.113.0/24 and
 * 2001:db8::/32 are not internal (an admin may block them; tests use them as
 * public visitors), yet an outbound request must never go there.
 *
 * Every address is first put into its canonical form (normalizeIp), so a hex
 * IPv4-mapped spelling like ::ffff:7f00:1 is judged as the 127.0.0.1 it is.
 * Pure and side-effect-free, so trivial to unit test.
 */

import { BlockList } from 'node:net';
import { normalizeIp } from '@libs/ip-address.js';

/**
 * Redact a URL so it is safe to log.
 *
 * Telegram embeds the bot token directly in the request path:
 *   https://api.telegram.org/bot<TOKEN>/getFile
 *   https://api.telegram.org/file/bot<TOKEN>/photos/file_1.jpg
 * Both forms (`/bot<token>/` and `/file/bot<token>/`) are rewritten to
 * `/bot<redacted>/`. Any query string is dropped wholesale (it can also carry
 * media tokens / signatures). Non-Telegram URLs pass through unchanged apart
 * from query stripping. NEVER throws — an unparseable string is returned with
 * just the same path-level redaction applied.
 */
export function redactUrl(url: string): string {
  if (typeof url !== 'string' || url.length === 0) {
    return url;
  }

  // Drop the query string (and fragment) — may hold API keys or signed tokens —
  // and credentials in the authority (https://user:password@host/).
  const noQuery = url.split(/[?#]/, 1)[0].replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1');

  // Rewrite Telegram bot-token path segments. The token charset is [A-Za-z0-9_-]
  // plus the ':' separating bot-id from secret, e.g. 123456:AAH...
  return noQuery.replace(/\/bot[A-Za-z0-9:_-]+/g, '/bot<redacted>');
}

/** Internal infrastructure ranges (isPrivateOrReservedIp). */
const INTERNAL = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], // "this network", incl. unspecified
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (incl. cloud metadata 169.254.169.254)
  ['172.16.0.0', 12], // private
  ['192.168.0.0', 16], // private
] as const) INTERNAL.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
] as const) INTERNAL.addSubnet(net, prefix, 'ipv6');

/** Not internal, but never a destination for an outbound request (isForbiddenOutboundIp). */
const NOT_PUBLIC = new BlockList();
for (const [net, prefix] of [
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation (TEST-NET-1)
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation (TEST-NET-2)
  ['203.0.113.0', 24], // documentation (TEST-NET-3)
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, incl. 255.255.255.255 broadcast
] as const) NOT_PUBLIC.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['64:ff9b::', 96], // NAT64: would reach any IPv4 address, internal ones too
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard
  ['2001::', 23], // IETF protocol assignments (incl. Teredo)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4: embeds an IPv4 address
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
] as const) NOT_PUBLIC.addSubnet(net, prefix, 'ipv6');

/** Canonical address and its family, or undefined for anything that is not an IP literal. */
function parse(addr: unknown): { ip: string; family: 'ipv4' | 'ipv6' } | undefined {
  if (typeof addr !== 'string') return undefined;
  const ip = normalizeIp(addr.replace(/^\[|\]$/g, ''));
  if (!ip) return undefined;
  const family = ip.includes(':') ? 'ipv6' : 'ipv4';
  // A zone id (fe80::1%eth0) is link-local by definition; BlockList cannot parse it.
  return { ip: family === 'ipv6' ? ip.split('%')[0] : ip, family };
}

/**
 * True when `addr` is internal infrastructure: loopback, private, link-local,
 * CGNAT, unique-local or unspecified (ranges above). IPv4-mapped IPv6, dotted
 * or hex, is judged as its IPv4 address.
 *
 * Unrecognised / unparseable input returns true (fail-closed): callers use this
 * to protect, so an address it cannot classify is treated as internal.
 */
export function isPrivateOrReservedIp(addr: string): boolean {
  const parsed = parse(addr);
  if (!parsed) return true;
  return INTERNAL.check(parsed.ip, parsed.family);
}

/**
 * True when an outbound request must not go to `addr`: anything internal
 * (isPrivateOrReservedIp) and every other address that is not public unicast.
 * Fail-closed like isPrivateOrReservedIp.
 */
export function isForbiddenOutboundIp(addr: string): boolean {
  const parsed = parse(addr);
  if (!parsed) return true;
  return INTERNAL.check(parsed.ip, parsed.family) || NOT_PUBLIC.check(parsed.ip, parsed.family);
}
