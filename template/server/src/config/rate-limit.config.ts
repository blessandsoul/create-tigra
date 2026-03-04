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
