/**
 * Rate-limit wiring for the app (limits themselves: src/config/rate-limit.config.ts).
 *
 * - registerRateLimiting(): the onRoute hook that gives every route without its own
 *   limit DEFAULT_LIMIT (own counter per route), then @fastify/rate-limit keyed on the
 *   verified visitor IP. Over-limit requests on non-auth routes earn IP auto-block
 *   strikes; every 429 is a TooManyRequestsError carrying retryAfterSeconds.
 * - registerNotFoundHandler(): unknown URLs answer in the error envelope and share one
 *   DEFAULT counter per IP (scanners get 429, then strikes).
 *
 * Never limited: MONITORING_PATHS (health probes come from infrastructure IPs), static
 * /uploads/* (one page can load dozens of public files) and CORS preflights.
 * Kept out of app.ts so tests can mount it on a bare Fastify with the in-memory store.
 */
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { DEFAULT_LIMIT, RATE_LIMIT_ENABLED } from '@config/rate-limit.config.js';
import { getClientIp } from '@libs/client-ip.js';
import { isAuthPath } from '@libs/auth-path.js';
import { recordRateLimitViolation } from '@libs/ip-block.js';
import { logger } from '@libs/logger.js';
import { TooManyRequestsError, describeWait } from '@shared/errors/errors.js';
import { errorResponse } from '@shared/responses/successResponse.js';

/**
 * Health endpoints: exempt from IP blocking, rate limiting and request logging. A blocked
 * probe IP would mark a healthy container as dead and restart-loop it. Matched exactly on
 * the path (query string stripped) so crafted URLs cannot widen the exemption. Must match
 * the route registrations in app.ts.
 */
export const MONITORING_PATHS = new Set(['/api/v1/health', '/api/v1/ready', '/api/v1/live']);

/** Public static files (avatars): cheap file reads, never rate limited. */
export function isUploadsPath(url: string): boolean {
  return url.startsWith('/uploads/');
}

export interface RateLimitingOptions {
  /** Shared counter store; omit for the in-memory store (tests, RATE_LIMIT_ENABLED=false). */
  redis?: Redis;
}

/**
 * Register the default-limit hook and the rate-limit plugin. Must run BEFORE any route is
 * registered: both only see routes added after them.
 */
export async function registerRateLimiting(app: FastifyInstance, options: RateLimitingOptions = {}): Promise<void> {
  // @fastify/rate-limit only limits routes that carry config.rateLimit (global: false).
  // This hook runs first for each new route and gives every other route DEFAULT_LIMIT
  // with its OWN counter (the plugin's `global` mode would put them all in one shared
  // counter). Health routes opt out with rateLimit: false.
  app.addHook('onRoute', (routeOptions) => {
    if (routeOptions.config?.rateLimit !== undefined) return; // own limit, or explicitly off
    const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method];
    if (methods.every((method) => method === 'OPTIONS')) return; // CORS preflight: no work done
    if (isUploadsPath(routeOptions.url) || MONITORING_PATHS.has(routeOptions.url)) return;
    routeOptions.config = { ...routeOptions.config, rateLimit: DEFAULT_LIMIT };
  });

  // Redis down → skipOnError lets requests through: limits are off until it is back
  // (accepted; see docs/rate-limits.md).
  await app.register(rateLimit, {
    global: false,
    max: DEFAULT_LIMIT.max,
    timeWindow: DEFAULT_LIMIT.timeWindow,
    ...(options.redis ? { redis: options.redis, nameSpace: 'rl:' } : {}),
    skipOnError: true,
    // Key on the verified visitor address (one counter per real visitor, and never an
    // address the visitor wrote itself) — see src/libs/client-ip.ts.
    keyGenerator: (request: FastifyRequest) => getClientIp(request),
    onExceeded: (request: FastifyRequest) => {
      // Auth routes keep their own per-route limit + account lockout; don't let a
      // mistyped password arm the IP-wide auto-ban.
      if (isAuthPath(request)) return;
      void recordRateLimitViolation(getClientIp(request));
    },
    // Thrown, so it reaches the app's error handler like any AppError.
    errorResponseBuilder: (_request, context) => {
      const seconds = Math.max(1, Math.ceil(context.ttl / 1000));
      return new TooManyRequestsError(
        `Too many requests. Try again in ${describeWait(seconds)}.`,
        'RATE_LIMIT_EXCEEDED',
        seconds,
      );
    },
  });

  if (!RATE_LIMIT_ENABLED) {
    logger.warn('[RATE-LIMIT] Rate limiting is DISABLED (RATE_LIMIT_ENABLED=false)');
  }
}

/**
 * Unknown URLs: 404 in the error envelope, counted under DEFAULT_LIMIT (one shared counter
 * per IP). A missing file under /uploads/ also lands here and stays exempt, like the
 * static files themselves. Call after registerRateLimiting().
 */
export function registerNotFoundHandler(app: FastifyInstance): void {
  const limiter = app.rateLimit(DEFAULT_LIMIT);
  app.setNotFoundHandler(
    {
      preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
        if (isUploadsPath(request.url)) return;
        await limiter.call(app, request, reply);
      },
    },
    (_request, reply) => reply.status(404).send(errorResponse('NOT_FOUND', 'Route not found')),
  );
}
