/**
 * Client IP resolution: verify before believing.
 *
 * Every per-visitor protection keys on this address: the rate limiter, the login lockout
 * (email + IP), the IP auto-block and the manual block list, plus session records and access
 * logs. Two failure modes have to be avoided at the same time:
 *
 *   1. SHARED COUNTERS. Behind Cloudflare and Coolify's Traefik, the TCP peer is the proxy, so
 *      using the socket address alone counts every visitor as one: a handful of users trip the
 *      limits together and lock each other out (this happened on real sites).
 *   2. FORGED ADDRESSES. `X-Forwarded-For` and `CF-Connecting-IP` are request headers the
 *      visitor can write. The previous version believed the LEFT-most X-Forwarded-For entry
 *      (written by the visitor) and believed CF-Connecting-IP from anyone when TRUST_CLOUDFLARE
 *      was on, so a client could pick its own key: dodge rate limits and lockouts, or get
 *      somebody else's address banned.
 *
 * How the address is chosen now:
 *
 *   - Fastify's `trustProxy` is set to TRUSTED_PROXY_RANGES (loopback, link-local and private
 *     networks). Coolify's Traefik reaches the app from a private Docker-network address, so it
 *     is trusted; anyone on the public internet is not. `request.ip` is then the right-most
 *     UNTRUSTED hop: the address our own proxy saw connecting to it. Entries a visitor writes
 *     into X-Forwarded-For sit to the left of that and are never used.
 *   - If that address belongs to Cloudflare's edge (cloudflare-ranges.ts), the request came
 *     from Cloudflare's network, and CF-Connecting-IP names the visitor, but only once the
 *     request is also VERIFIED as genuine traffic of this app's own zone (see below).
 *   - Otherwise that address is the visitor (a direct visitor, a grey-cloud domain, sslip.io).
 *
 * Why Cloudflare's ranges alone are not proof: they are shared by every Cloudflare customer.
 * A Cloudflare Worker (free for anyone) that fetches one of this app's NON-Cloudflare addresses
 * (sslip.io, a grey-cloud record, the server IP) leaves from those ranges and may set
 * CF-Connecting-IP to any value (Cloudflare documents this). So a Cloudflare request counts as
 * verified only when:
 *   - CLOUDFLARE_ORIGIN_SECRET is set: it carries the matching X-Origin-Verify header, which a
 *     Transform Rule on the owner's own zone adds (Cloudflare's recommended origin proof); or
 *   - no secret is set: it does not carry the CF-Worker header that Cloudflare adds to Worker
 *     subrequests (documented as added; not documented as unremovable, hence the secret).
 * An unverified Cloudflare request is keyed on ONE fixed bucket, never on the address it claims:
 * it can neither pick a fresh key per attempt nor spread across Cloudflare's many edge addresses.
 *
 * TRUST_CLOUDFLARE no longer exists (an old value is ignored). Behind a proxy or CDN other than
 * Cloudflare and Traefik, the result is that proxy's address: counters are then shared, which
 * is strict but cannot be forged. See docs/client-ip-behind-proxies.md.
 */
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { env } from '@config/env.js';
import { isCloudflareIp } from '@libs/cloudflare-ranges.js';

/** Header the owner's Cloudflare Transform Rule adds (names starting with cf- or x-cf- cannot be set there). */
export const ORIGIN_VERIFY_HEADER = 'x-origin-verify';
/** Rate-limit / lockout key shared by every Cloudflare request that could not be verified. */
export const UNVERIFIED_CLOUDFLARE_KEY = 'cloudflare-unverified';

/**
 * Hops whose X-Forwarded-For entries are trusted (proxy-addr keywords): loopback
 * (127.0.0.0/8, ::1), link-local (169.254.0.0/16, fe80::/10) and private networks
 * (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7). Passed to Fastify as `trustProxy`.
 * Cloudflare's ranges are deliberately NOT here: a Cloudflare hop is only believed through
 * CF-Connecting-IP, which Cloudflare itself overwrites.
 */
export const TRUSTED_PROXY_RANGES = 'loopback,linklocal,uniquelocal';

/**
 * Where the resolved address came from: Cloudflare's header on a verified request, a Cloudflare
 * request that could not be verified (fixed bucket), our proxy's record, or the TCP peer.
 */
export type ClientIpSource = 'cloudflare' | 'cloudflare-unverified' | 'proxy' | 'socket';

export interface ResolvedClientIp {
  ip: string;
  source: ClientIpSource;
}

/**
 * Canonical form of an address so one visitor always maps to one key: IPv4-mapped IPv6
 * (`::ffff:203.0.113.7`) becomes plain IPv4, IPv6 is lower-cased. Returns undefined for
 * anything that is not an IP literal.
 */
export function normalizeIp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let ip = value.trim();
  if (ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  if (isIP(ip) === 0) return undefined;
  return ip.includes(':') ? ip.toLowerCase() : ip;
}

/**
 * Resolve the visitor address and say where it came from. Synchronous and always returns a
 * non-empty address, so it can serve directly as a rate-limit key.
 */
export function resolveClientIp(request: FastifyRequest): ResolvedClientIp {
  const socketIp = normalizeIp(request.socket?.remoteAddress);
  // request.ip = the right-most untrusted hop (see TRUSTED_PROXY_RANGES); falls back to the
  // raw socket address, then a constant, so a key always exists.
  const peer = normalizeIp(request.ip) ?? socketIp ?? request.ip ?? 'unknown';

  if (isCloudflareIp(peer)) {
    if (!isVerifiedCloudflareRequest(request)) return { ip: UNVERIFIED_CLOUDFLARE_KEY, source: 'cloudflare-unverified' };
    const header = request.headers['cf-connecting-ip'];
    const visitor = normalizeIp(typeof header === 'string' ? header : undefined);
    if (visitor) return { ip: visitor, source: 'cloudflare' };
    // A verified Cloudflare request always carries the header; without it, stay on the edge
    // address (strict) rather than guess.
  }

  return { ip: peer, source: socketIp !== undefined && peer !== socketIp ? 'proxy' : 'socket' };
}

/**
 * Whether a request that arrived from Cloudflare's network is genuine traffic of this app's own
 * zone, so its CF-Connecting-IP can be believed (see the module header for why ranges alone are
 * not enough).
 */
function isVerifiedCloudflareRequest(request: FastifyRequest): boolean {
  const secret = env.CLOUDFLARE_ORIGIN_SECRET;
  if (secret) {
    const presented = request.headers[ORIGIN_VERIFY_HEADER];
    if (typeof presented !== 'string') return false;
    const a = Buffer.from(presented);
    const b = Buffer.from(secret);
    // Constant-time comparison; differing lengths are rejected first (timingSafeEqual throws).
    return a.length === b.length && timingSafeEqual(a, b);
  }
  return request.headers['cf-worker'] === undefined;
}

/**
 * The address to key rate limits, lockouts, IP blocks, sessions and logs on.
 * Every caller in the app must use this rather than reading request.ip or the headers itself.
 */
export function getClientIp(request: FastifyRequest): string {
  return resolveClientIp(request).ip;
}
