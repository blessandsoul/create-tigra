/**
 * Client IP resolution — Cloudflare- and reverse-proxy-aware.
 *
 * Behind a Cloudflare proxy (or any reverse proxy such as Traefik/Coolify),
 * Fastify's `request.ip` (derived from the socket / X-Forwarded-For) resolves
 * to an *edge* IP, not the real visitor. Every request through one edge node
 * then shares a single IP, which collapses the per-IP rate limiter and the IP
 * auto-block onto that shared edge address: one abusive client can rate-limit
 * or self-ban every legitimate user behind the same edge, and conversely abuse
 * from many clients hides behind one IP.
 *
 * Resolution is ordered, and every header value is VALIDATED as a real IPv4/IPv6
 * literal (via `node:net.isIP`) before it is trusted — a junk or spoofed header
 * falls through to the next tier instead of becoming the rate-limit key:
 *
 *   1. `CF-Connecting-IP` — the genuine client IP Cloudflare injects. Consulted
 *      ONLY when `TRUST_CLOUDFLARE` is enabled (orange-cloud / proxied origin).
 *   2. Left-most VALID `X-Forwarded-For` entry — the original client, appended by
 *      the reverse proxy. XFF is a comma-separated list (client, proxy1, proxy2,
 *      ...), so the original client is the left-most entry. This tier is consulted
 *      regardless of the flag: it covers the grey-cloud / DNS-only case where the
 *      Cloudflare header is absent but traffic still arrives through Traefik —
 *      without it, every grey-clouded visitor collapses onto the single shared
 *      Traefik upstream IP and trips the auto-block site-wide.
 *   3. `request.ip` — Fastify's socket / trustProxy-resolved peer IP (always
 *      non-empty), the safe fallback for any origin reachable directly.
 *
 * SECURITY PRECONDITION: both `CF-Connecting-IP` and `X-Forwarded-For` are
 * client-supplied and therefore SPOOFABLE if a caller can reach the origin
 * directly. They are only trustworthy when the origin accepts traffic
 * EXCLUSIVELY via the proxy (Cloudflare / Traefik) — a documented deploy
 * precondition. Validation here narrows the spoof surface to well-formed IP
 * literals but does not, on its own, prove provenance.
 *
 * Use this for rate-limiting and IP-blocking decisions. Logging / session
 * metadata can keep using `request.ip` — there a spoofed value is harmless.
 */

import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';
import { env } from '@config/env.js';

/** Return the trimmed value if it is a valid IPv4/IPv6 literal, else undefined. */
function asValidIp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return isIP(trimmed) !== 0 ? trimmed : undefined;
}

/**
 * Resolve the real client IP for rate-limiting / blocking decisions.
 *
 * Synchronous and always returns a non-empty string (the `request.ip` fallback
 * guarantees this), so it is safe to use directly as a rate-limit `keyGenerator`.
 *
 * @param request - The incoming Fastify request
 * @returns The client IP to use as the rate-limit / block key
 */
export function getClientIp(request: FastifyRequest): string {
  // 1. CF-Connecting-IP — only when TRUST_CLOUDFLARE is set (origin locked to CF).
  if (env.TRUST_CLOUDFLARE) {
    const cfHeader = request.headers['cf-connecting-ip'];
    const cf = asValidIp(typeof cfHeader === 'string' ? cfHeader : undefined);
    if (cf) return cf;
  }
  // 2. Left-most VALID X-Forwarded-For entry — the original client, appended by the
  //    reverse proxy (Traefik/Coolify). Covers grey-cloud / DNS-only where the CF
  //    header is absent. Validated so a junk/spoofed header falls through.
  const xffRaw = request.headers['x-forwarded-for'];
  const xff = typeof xffRaw === 'string' ? xffRaw : Array.isArray(xffRaw) ? xffRaw[0] : undefined;
  if (xff) {
    const leftMost = asValidIp(xff.split(',')[0]);
    if (leftMost) return leftMost;
  }
  // 3. Fastify's socket/trustProxy-resolved peer IP (always non-empty).
  return request.ip;
}
