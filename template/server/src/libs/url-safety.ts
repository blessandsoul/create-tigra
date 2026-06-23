/**
 * URL/IP safety helpers shared across outbound-HTTP code paths.
 *
 *  - `redactUrl`            — strips secrets (Telegram bot tokens, query strings)
 *                             from a URL before it reaches any log sink.
 *  - `isPrivateOrReservedIp`— SSRF building block: returns true for any loopback /
 *                             private / link-local / ULA / reserved address so the
 *                             image-fetch guard can reject internal targets.
 *
 * Pure, dependency-free, and side-effect-free so they are trivial to unit test.
 */

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

  // Drop the query string (and fragment) — may hold signed tokens.
  const noQuery = url.split(/[?#]/, 1)[0];

  // Rewrite Telegram bot-token path segments. The token charset is [A-Za-z0-9_-]
  // plus the ':' separating bot-id from secret, e.g. 123456:AAH...
  return noQuery.replace(/\/bot[A-Za-z0-9:_-]+/g, '/bot<redacted>');
}

/**
 * True when `addr` is a loopback / private / link-local / ULA / unspecified /
 * reserved IP that an SSRF target could use to reach internal infrastructure.
 *
 * Covers:
 *   IPv4: 0.0.0.0, 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10 (CGNAT)
 *   IPv6: ::, ::1, fc00::/7 (ULA), fe80::/10 (link-local)
 *   IPv4-mapped IPv6 (::ffff:a.b.c.d) — re-checked against the IPv4 rules.
 *
 * Unrecognised / unparseable input returns true (fail-closed) — the caller
 * uses this purely to BLOCK, so an address it cannot classify is treated as
 * unsafe rather than silently allowed.
 */
export function isPrivateOrReservedIp(addr: string): boolean {
  if (typeof addr !== 'string' || addr.length === 0) {
    return true;
  }

  const ip = addr.trim().toLowerCase();

  // IPv4-mapped IPv6, e.g. ::ffff:10.0.0.5 or ::ffff:0a00:0005 — extract the v4 tail.
  const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) {
    return isPrivateOrReservedIpv4(mapped[1]);
  }

  if (ip.includes(':')) {
    return isReservedIpv6(ip);
  }

  return isPrivateOrReservedIpv4(ip);
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return true; // not a clean dotted-quad → block
  }

  const octets = parts.map((p) => Number(p));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    return true; // malformed → block
  }

  const [a, b] = octets;

  if (a === 0) return true; // 0.0.0.0/8 (incl. unspecified)
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT

  return false;
}

function isReservedIpv6(ip: string): boolean {
  // Normalise: drop zone id (fe80::1%eth0) and any brackets.
  const bare = ip.replace(/^\[|\]$/g, '').split('%')[0];

  if (bare === '::' || bare === '::0' || bare === '0:0:0:0:0:0:0:0') return true; // unspecified
  if (bare === '::1') return true; // loopback

  // First hextet determines ULA / link-local ranges.
  const firstHextet = bare.split(':')[0];
  if (firstHextet === '') {
    // Address starts with '::' (e.g. '::abcd') — already handled the special
    // cases above; remaining such addresses are not in fc00::/7 or fe80::/10.
    return false;
  }

  const value = parseInt(firstHextet, 16);
  if (Number.isNaN(value)) {
    return true; // unparseable hextet → block
  }

  // fc00::/7  → first 7 bits = 1111110  → first byte 0xfc or 0xfd
  if ((value & 0xfe00) === 0xfc00) return true;
  // fe80::/10 → first 10 bits = 1111111010 → 0xfe80..0xfebf
  if ((value & 0xffc0) === 0xfe80) return true;

  return false;
}
