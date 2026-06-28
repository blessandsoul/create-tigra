/**
 * Rate Limiting Configuration
 *
 * Single source of truth for all rate limit values.
 * Routes import from here instead of hardcoding limits.
 *
 * ENV controls:
 * - RATE_LIMIT_ENABLED: master switch (default: true)
 * - RATE_LIMIT_MULTIPLIER: multiply all max values (default: 1, set 10 for dev)
 * - RATE_LIMIT_AUTH_LOGIN_MAX: override login max
 * - RATE_LIMIT_AUTH_REGISTER_MAX: override register max
 *
 * ── Self-ban interaction with IP auto-block (read before tightening limits) ──
 * Every rate-limit exceedance records ONE violation against the client IP
 * (app.ts `onExceeded` → recordRateLimitViolation). An IP that accumulates
 * IP_AUTO_BLOCK_THRESHOLD violations (default 20) within
 * IP_AUTO_BLOCK_WINDOW_SECONDS (default 300s) is auto-blocked for
 * IP_AUTO_BLOCK_DURATION_SECONDS (default 1h) — for EVERY route.
 *
 * Rate limits are counted BEFORE validation, so a legitimate client stuck in a
 * retry loop on a 400/422 response still burns quota; and NAT'd offices share
 * one counter per IP. When tuning a route, keep
 *   (realistic retries per window) × (windows per 5 min) well below the
 * auto-block threshold, or a legit retry pattern self-bans for an hour.
 * Example: AUTH_LOGIN at 10/15min can produce at most a handful of violations
 * per 5-minute window — safely below 20. A hypothetical 5/10s limit could
 * produce 30 violations in 5 minutes and trip the auto-block on its own.
 */

import { env } from '@config/env.js';
import { getRedis } from '@libs/redis.js';
import { logger } from '@libs/logger.js';
import type { Redis } from 'ioredis';

// ─── Global settings ───────────────────────────────────────────

export const RATE_LIMIT_ENABLED = env.RATE_LIMIT_ENABLED;

const MULTIPLIER = env.RATE_LIMIT_MULTIPLIER;

/**
 * Apply the global multiplier to a max value.
 * Ensures minimum of 1 if rate limiting is enabled.
 */
function applyMultiplier(max: number): number {
  if (!RATE_LIMIT_ENABLED) return 1_000_000;
  return Math.max(1, Math.round(max * MULTIPLIER));
}

// ─── Per-route configs ─────────────────────────────────────────

export const RATE_LIMITS = {
  // Auth routes
  AUTH_REGISTER: {
    max: applyMultiplier(env.RATE_LIMIT_AUTH_REGISTER_MAX ?? 5),
    timeWindow: '1 hour',
  },
  AUTH_LOGIN: {
    max: applyMultiplier(env.RATE_LIMIT_AUTH_LOGIN_MAX ?? 10),
    timeWindow: '15 minutes',
  },
  AUTH_LOGOUT: {
    max: applyMultiplier(50),
    timeWindow: '15 minutes',
  },
  AUTH_REFRESH: {
    max: applyMultiplier(20),
    timeWindow: '15 minutes',
  },
  AUTH_ME: {
    max: applyMultiplier(60),
    timeWindow: '1 minute',
  },
  AUTH_SESSIONS: {
    max: applyMultiplier(30),
    timeWindow: '1 minute',
  },
  AUTH_LOGOUT_ALL: {
    max: applyMultiplier(10),
    timeWindow: '15 minutes',
  },
  AUTH_FORGOT_PASSWORD: {
    max: applyMultiplier(5),
    timeWindow: '15 minutes',
  },
  AUTH_RESET_PASSWORD: {
    max: applyMultiplier(10),
    timeWindow: '15 minutes',
  },

  // Users — profile management
  USERS_UPDATE_PROFILE: {
    max: applyMultiplier(10),
    timeWindow: '1 minute',
  },
  USERS_CHANGE_PASSWORD: {
    max: applyMultiplier(5),
    timeWindow: '1 minute',
  },
  USERS_DELETE_ACCOUNT: {
    max: applyMultiplier(3),
    timeWindow: '1 minute',
  },

  // Users — avatar management
  USERS_UPLOAD_AVATAR: {
    max: applyMultiplier(5),
    timeWindow: '1 minute',
  },
  USERS_DELETE_AVATAR: {
    max: applyMultiplier(10),
    timeWindow: '1 minute',
  },
  USERS_GET_AVATAR: {
    max: applyMultiplier(100),
    timeWindow: '1 minute',
  },

  // Files — auth-gated private file streaming
  FILES_GET: {
    max: applyMultiplier(100),
    timeWindow: '1 minute',
  },

  // Admin routes
  ADMIN_DEFAULT: {
    max: applyMultiplier(30),
    timeWindow: '1 minute',
  },
} as const;

// ─── Redis store helper ────────────────────────────────────────

/**
 * Returns the Redis instance for @fastify/rate-limit's `redis` option.
 * Returns undefined if Redis is not available (falls back to in-memory).
 */
export function getRateLimitRedisStore(): Redis | undefined {
  try {
    return getRedis();
  } catch {
    logger.warn('[RATE-LIMIT] Redis unavailable, falling back to in-memory store');
    return undefined;
  }
}
