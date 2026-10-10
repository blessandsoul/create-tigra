import type { FastifyReply } from 'fastify';
import { env } from '@config/env.js';
import { parseDurationMs } from '@libs/duration.js';

const isProduction = env.NODE_ENV === 'production';

// Cross-origin deployment: client and API on different subdomains require sameSite 'none'.
// Same-origin deployment (or local dev): 'strict' is the safest default.
const isCrossOrigin = Boolean(env.COOKIE_DOMAIN);
const sameSitePolicy = isProduction && isCrossOrigin ? 'none' as const : 'strict' as const;

/**
 * Cookie scope rules:
 *  - access_token / refresh_token are bearer credentials and are HOST-ONLY (no
 *    Domain attribute): the browser sends them only to the API host that set
 *    them. Only the API ever reads them — the client calls the API directly
 *    with credentials — so sharing them with every sibling subdomain would
 *    only leak live logins to hosts that don't need them (a CNAME'd help desk,
 *    another app on the same domain, a compromised subdomain).
 *  - auth_session ("1", no secret) is the one cookie that must be visible to
 *    the client host's Next.js middleware, so it alone uses COOKIE_DOMAIN
 *    (e.g. ".example.com" covers app.example.com + api.example.com).
 */
const sessionIndicatorDomain = env.COOKIE_DOMAIN || undefined;

const ACCESS_TOKEN_MAX_AGE_MS = parseDurationMs(env.JWT_ACCESS_EXPIRY, 15 * 60 * 1000);
const REFRESH_TOKEN_MAX_AGE_MS = parseDurationMs(env.JWT_REFRESH_EXPIRY, 7 * 24 * 60 * 60 * 1000);

const ACCESS_TOKEN_PATH = '/';
const REFRESH_TOKEN_PATH = '/api/v1/auth';

/**
 * Older versions of this template scoped the token cookies to COOKIE_DOMAIN.
 * Browsers that still hold those would send two access_token cookies after an
 * upgrade (the old domain-wide one can win and break auth), so whenever we set
 * or clear tokens we also expire any domain-wide copies. No-op without
 * COOKIE_DOMAIN. Safe to keep: expiring a cookie that doesn't exist is harmless.
 */
function expireLegacyDomainTokenCookies(reply: FastifyReply): void {
  if (!sessionIndicatorDomain) return;
  const legacy = { httpOnly: true, secure: isProduction, sameSite: sameSitePolicy, domain: sessionIndicatorDomain };
  reply.clearCookie('access_token', { ...legacy, path: ACCESS_TOKEN_PATH });
  reply.clearCookie('refresh_token', { ...legacy, path: REFRESH_TOKEN_PATH });
}

export function setAuthCookies(
  reply: FastifyReply,
  accessToken: string,
  refreshToken: string,
): void {
  expireLegacyDomainTokenCookies(reply);

  reply.setCookie('access_token', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: sameSitePolicy,
    path: ACCESS_TOKEN_PATH,
    maxAge: Math.floor(ACCESS_TOKEN_MAX_AGE_MS / 1000), // setCookie expects seconds
  });

  reply.setCookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: sameSitePolicy,
    path: REFRESH_TOKEN_PATH,
    maxAge: Math.floor(REFRESH_TOKEN_MAX_AGE_MS / 1000),
  });

  // Non-sensitive session indicator visible to Next.js middleware and client JS.
  // Lets middleware distinguish "never logged in" from "access token expired but session alive."
  reply.setCookie('auth_session', '1', {
    httpOnly: false,
    secure: isProduction,
    sameSite: sameSitePolicy,
    domain: sessionIndicatorDomain,
    path: '/',
    maxAge: Math.floor(REFRESH_TOKEN_MAX_AGE_MS / 1000),
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  expireLegacyDomainTokenCookies(reply);

  reply.clearCookie('access_token', {
    httpOnly: true,
    secure: isProduction,
    sameSite: sameSitePolicy,
    path: ACCESS_TOKEN_PATH,
  });

  reply.clearCookie('refresh_token', {
    httpOnly: true,
    secure: isProduction,
    sameSite: sameSitePolicy,
    path: REFRESH_TOKEN_PATH,
  });

  reply.clearCookie('auth_session', {
    httpOnly: false,
    secure: isProduction,
    sameSite: sameSitePolicy,
    domain: sessionIndicatorDomain,
    path: '/',
  });
}
