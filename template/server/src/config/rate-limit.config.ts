/**
 * Rate limiting configuration: the single source of every limit.
 *
 * What is counted (see docs/rate-limits.md for the full picture):
 * - Every entry below is per visitor IP (getClientIp) and per route: each route
 *   keeps its own counter, even when two routes share an entry.
 * - A route with no entry gets DEFAULT_LIMIT (its own counter per route) through
 *   the onRoute hook in app.ts. Unknown URLs (404s) share one DEFAULT counter.
 * - Never limited: /api/v1/health, /api/v1/ready, /api/v1/live, static /uploads/*
 *   and CORS preflights.
 * - EMAIL_PER_ADDRESS caps emails to one address, per counter (public flows such as
 *   forgot-password, and the sign-in re-send separately; see src/libs/email-quota.ts).
 *   Login lockout lives in modules/auth/auth.service.ts.
 *
 * ENV controls:
 * - RATE_LIMIT_ENABLED: master switch (default true). Off = every max is 1,000,000.
 * - RATE_LIMIT_MULTIPLIER: scales every max (default 1; e.g. 10 for local development).
 * - RATE_LIMIT_OVERRIDES: "NAME=MAX/WINDOW,..." with WINDOW like 30s, 15m or 1h, and
 *   NAME any key of RATE_LIMITS, DEFAULT or EMAIL_PER_ADDRESS. An override replaces
 *   that limit's max and window; the multiplier still applies. A bad entry stops the
 *   server at boot with the list of valid names.
 *
 * ── Self-ban interaction with IP auto-block (read before tightening limits) ──
 * Every request over a limit on a NON-auth route records one strike against the IP
 * (app.ts `onExceeded` → recordRateLimitViolation). IP_AUTO_BLOCK_THRESHOLD strikes
 * (default 20) within IP_AUTO_BLOCK_WINDOW_SECONDS (default 300 s) block the IP for
 * IP_AUTO_BLOCK_DURATION_SECONDS (default 1 h) on EVERY route. /api/v1/auth/* adds
 * no strikes: a mistyped password must never ban a whole network.
 *
 * Counting happens before validation, and offices or mobile carriers put many people
 * behind one IP. So the strike budget is about 20 requests ABOVE a limit in five
 * minutes. A client that keeps hammering a short-window route after its 429 (the
 * client does not auto-retry 429s, but a script might) bans itself within minutes:
 * e.g. avatar upload at 10/min retried once a second earns ~50 strikes a minute.
 * Keep short windows only on routes a person cannot reasonably hammer.
 */

import { env } from '@config/env.js';
import { logger } from '@libs/logger.js';

// ─── Global settings ───────────────────────────────────────────

export const RATE_LIMIT_ENABLED = env.RATE_LIMIT_ENABLED;

const MULTIPLIER = env.RATE_LIMIT_MULTIPLIER;

/** A limit as @fastify/rate-limit takes it: `timeWindow` in milliseconds. */
export interface RouteLimit {
  max: number;
  timeWindow: number;
}

/** Thrown for a malformed RATE_LIMIT_OVERRIDES entry or window; becomes a boot failure. */
export class RateLimitConfigError extends Error {}

const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000 } as const;

/** "15m" → 900000. A whole number of at least 1 with an s, m or h suffix. */
export function parseWindow(text: string): number {
  const match = /^(\d+)([smh])$/.exec(text.trim());
  if (!match || Number(match[1]) < 1) {
    throw new RateLimitConfigError(`invalid window "${text}" (use e.g. 30s, 15m or 1h)`);
  }
  return Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
}

/**
 * Parse RATE_LIMIT_OVERRIDES ("NAME=MAX/WINDOW,..."). Checks the format only;
 * names are checked once every limit exists (see the end of this file).
 */
export function parseOverrides(raw: string | undefined): Map<string, RouteLimit> {
  const overrides = new Map<string, RouteLimit>();
  if (!raw?.trim()) return overrides;
  for (const part of raw.split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(\d+)\/(\S+)$/.exec(entry);
    if (!match) {
      throw new RateLimitConfigError(`invalid entry "${entry}" (expected NAME=MAX/WINDOW, e.g. AUTH_LOGIN=100/15m)`);
    }
    const [, name, maxText, windowText] = match;
    const max = Number(maxText);
    if (!Number.isSafeInteger(max) || max < 1) {
      throw new RateLimitConfigError(`invalid max in "${entry}" (a whole number of at least 1)`);
    }
    if (overrides.has(name)) {
      throw new RateLimitConfigError(`${name} is set more than once`);
    }
    overrides.set(name, { max, timeWindow: parseWindow(windowText) });
  }
  return overrides;
}

/** Override names that match no limit (a typo would otherwise be silently ignored). */
export function unknownOverrideNames(overrides: Map<string, RouteLimit>, known: Iterable<string>): string[] {
  const knownNames = new Set(known);
  return [...overrides.keys()].filter((name) => !knownNames.has(name));
}

/** Configuration mistakes stop the server before it serves anything (same style as env.ts). */
function failBoot(message: string): never {
  console.error(`\nInvalid RATE_LIMIT_OVERRIDES: ${message}\n`);
  process.exit(1);
}

function loadOverrides(): Map<string, RouteLimit> {
  try {
    return parseOverrides(env.RATE_LIMIT_OVERRIDES);
  } catch (error) {
    return failBoot(error instanceof Error ? error.message : String(error));
  }
}

const OVERRIDES = loadOverrides();

/**
 * Apply the global multiplier to a max value.
 * Ensures minimum of 1 if rate limiting is enabled.
 */
function applyMultiplier(max: number): number {
  if (!RATE_LIMIT_ENABLED) return 1_000_000;
  return Math.max(1, Math.round(max * MULTIPLIER));
}

/**
 * One limit. An override for `name` replaces the default max and window, then
 * the multiplier scales the max. `name` must equal the RATE_LIMITS key (the
 * overrides use it). The email-verification patcher adds its two entries with
 * this helper, so keep the name and signature.
 */
function routeLimit(name: string, max: number, window: string): RouteLimit {
  const override = OVERRIDES.get(name);
  return {
    max: applyMultiplier(override?.max ?? max),
    timeWindow: override?.timeWindow ?? parseWindow(window),
  };
}

// ─── Per-route configs ─────────────────────────────────────────
// Keep this an object literal: the email-verification patcher appends to it.

export const RATE_LIMITS = {
  // Auth routes (no auto-block strikes; login also has the email + IP lockout)
  AUTH_REGISTER: routeLimit('AUTH_REGISTER', 40, '1h'),
  AUTH_LOGIN: routeLimit('AUTH_LOGIN', 100, '15m'),
  AUTH_LOGOUT: routeLimit('AUTH_LOGOUT', 200, '15m'),
  AUTH_REFRESH: routeLimit('AUTH_REFRESH', 200, '15m'),
  AUTH_ME: routeLimit('AUTH_ME', 200, '1m'),
  AUTH_SESSIONS: routeLimit('AUTH_SESSIONS', 30, '1m'),
  AUTH_LOGOUT_ALL: routeLimit('AUTH_LOGOUT_ALL', 10, '15m'),
  // Sends an email: also capped per address by EMAIL_PER_ADDRESS.
  AUTH_FORGOT_PASSWORD: routeLimit('AUTH_FORGOT_PASSWORD', 20, '15m'),
  AUTH_RESET_PASSWORD: routeLimit('AUTH_RESET_PASSWORD', 100, '15m'),

  // Users — profile management (the admin /users/:userId/... routes share these)
  USERS_UPDATE_PROFILE: routeLimit('USERS_UPDATE_PROFILE', 30, '1m'),
  // Checks the current password: kept low so a stolen session cannot guess it.
  USERS_CHANGE_PASSWORD: routeLimit('USERS_CHANGE_PASSWORD', 10, '15m'),
  USERS_DELETE_ACCOUNT: routeLimit('USERS_DELETE_ACCOUNT', 10, '1m'),

  // Users — avatar management (an upload decodes up to 50 MP: real CPU work)
  USERS_UPLOAD_AVATAR: routeLimit('USERS_UPLOAD_AVATAR', 10, '1m'),
  USERS_DELETE_AVATAR: routeLimit('USERS_DELETE_AVATAR', 30, '1m'),

  // Files — auth-gated private file streaming
  FILES_GET: routeLimit('FILES_GET', 100, '1m'),

  // Admin routes
  ADMIN_DEFAULT: routeLimit('ADMIN_DEFAULT', 30, '1m'),
} as const;

/** Any route without its own entry (own counter per route), and unknown URLs. */
export const DEFAULT_LIMIT: RouteLimit = routeLimit('DEFAULT', 200, '1m');

/** Emails to one address per window, applied to each email counter (src/libs/email-quota.ts). */
export const EMAIL_PER_ADDRESS: RouteLimit = routeLimit('EMAIL_PER_ADDRESS', 3, '1h');

// ─── Boot checks ───────────────────────────────────────────────

// Checked only now, so entries appended to RATE_LIMITS (email-verification module)
// count as known names.
const VALID_OVERRIDE_NAMES = [...Object.keys(RATE_LIMITS), 'DEFAULT', 'EMAIL_PER_ADDRESS'];
const unknownNames = unknownOverrideNames(OVERRIDES, VALID_OVERRIDE_NAMES);
if (unknownNames.length > 0) {
  failBoot(`unknown name(s): ${unknownNames.join(', ')}. Valid names: ${VALID_OVERRIDE_NAMES.join(', ')}`);
}

// Removed variables: say so instead of silently changing a deployment's limits.
for (const removed of ['RATE_LIMIT_AUTH_LOGIN_MAX', 'RATE_LIMIT_AUTH_REGISTER_MAX']) {
  if (process.env[removed]) {
    logger.warn(
      `[RATE-LIMIT] ${removed} is no longer read and its value is ignored. ` +
        'Use RATE_LIMIT_OVERRIDES instead, e.g. RATE_LIMIT_OVERRIDES=AUTH_LOGIN=100/15m',
    );
  }
}
