import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';
import { env } from '@config/env.js';

/**
 * Resolve the real client IP for security decisions (rate-limiting, IP blocking).
 *
 * Behind a reverse proxy, Fastify's `request.ip` resolves to the proxy's edge IP —
 * which is SHARED across every visitor. Keying the rate-limiter and IP auto-blocker
 * on that shared IP collapses all users into one bucket, so a single noisy client
 * trips the limiter and the whole site gets 403'd (IP_BLOCKED).
 *
 * Resolution is ordered, and every header value is VALIDATED as a real IP literal
 * (via node:net.isIP) before it is trusted — a junk or spoofed header falls through
 * to the next tier instead of becoming the rate-limit key:
 *
 *   1. `CF-Connecting-IP` — the true origin IP Cloudflare injects. Only consulted when
 *      TRUST_CLOUDFLARE is enabled (orange-cloud / proxied origin).
 *   2. Left-most valid `X-Forwarded-For` entry — the original client, appended by the
 *      reverse proxy (Traefik/Coolify). XFF is a comma-separated list (client, proxy1,
 *      proxy2, ...), so the original client is the left-most entry. This tier covers the
 *      grey-cloud / DNS-only case where the Cloudflare header is absent but traffic still
 *      arrives through Traefik — without it, every grey-clouded visitor collapses onto the
 *      single shared Traefik upstream IP and trips the auto-block site-wide.
 *   3. `request.ip` — Fastify's socket / trustProxy-resolved peer IP (always non-empty).
 *
 * SECURITY PRECONDITION: both CF-Connecting-IP and X-Forwarded-For are client-supplied
 * and therefore SPOOFABLE if a caller can reach the origin directly. They are only
 * trustworthy when the origin accepts traffic EXCLUSIVELY via the proxy (Cloudflare /
 * Traefik) — a documented deploy precondition. Validation here narrows the spoof surface
 * to well-formed IP literals but does not, on its own, prove provenance.
 *
 * Synchronous and always returns a non-empty string (the `request.ip` fallback
 * guarantees this), so it is safe to use directly as a rate-limit `keyGenerator`.
 *
 * @param request - The incoming Fastify request
 * @returns The client IP to use as the rate-limit / block key
 */
function asValidIp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return isIP(trimmed) !== 0 ? trimmed : undefined;
}

export function getClientIp(request: FastifyRequest): string {
  // 1. CF-Connecting-IP — only when TRUST_CLOUDFLARE is set (origin locked to CF).
  if (env.TRUST_CLOUDFLARE) {
    const cfHeader = request.headers['cf-connecting-ip'];
    const cf = asValidIp(typeof cfHeader === 'string' ? cfHeader : undefined);
    if (cf) return cf;
  }
  // 2. Left-most VALID X-Forwarded-For entry — the original client, appended by the
  //    reverse proxy (Traefik/Coolify). Covers grey-cloud / DNS-only where CF header
  //    is absent. Validated so a junk/spoofed header falls through.
  const xffRaw = request.headers['x-forwarded-for'];
  const xff = typeof xffRaw === 'string' ? xffRaw : Array.isArray(xffRaw) ? xffRaw[0] : undefined;
  if (xff) {
    const leftMost = asValidIp(xff.split(',')[0]);
    if (leftMost) return leftMost;
  }
  // 3. Fastify's socket/trustProxy-resolved peer IP (always non-empty).
  return request.ip;
}
