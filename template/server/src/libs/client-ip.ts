/**
 * Client IP resolution — Cloudflare-aware.
 *
 * Behind a Cloudflare proxy, Fastify's `request.ip` (derived from the socket /
 * X-Forwarded-For) resolves to a Cloudflare *edge* IP, not the real visitor.
 * Every request through one edge node then shares a single IP, which collapses
 * the per-IP rate limiter and the IP auto-block onto that shared edge address:
 * one abusive client can rate-limit or self-ban every legitimate user behind
 * the same edge, and conversely abuse from many clients hides behind one IP.
 *
 * Cloudflare forwards the genuine client IP in the `CF-Connecting-IP` header.
 * We trust it ONLY when `TRUST_CLOUDFLARE` is enabled — because the header is
 * client-spoofable unless the origin accepts traffic *exclusively* via
 * Cloudflare. With the flag off (the default) we fall back to `request.ip`,
 * which is the safe behaviour for any origin reachable directly.
 *
 * Use this for rate-limiting and IP-blocking decisions. Logging / session
 * metadata can keep using `request.ip` — there a spoofed value is harmless.
 */

import type { FastifyRequest } from 'fastify';
import { env } from '@config/env.js';

/**
 * Resolve the real client IP for rate-limiting / blocking decisions.
 *
 * @param request - The incoming Fastify request
 * @returns The `CF-Connecting-IP` header when `TRUST_CLOUDFLARE` is enabled and
 *          the header is a non-empty string; otherwise Fastify's `request.ip`.
 */
export function getClientIp(request: FastifyRequest): string {
  if (env.TRUST_CLOUDFLARE) {
    const cfConnectingIp = request.headers['cf-connecting-ip'];
    if (typeof cfConnectingIp === 'string' && cfConnectingIp.length > 0) {
      return cfConnectingIp;
    }
  }
  return request.ip;
}
