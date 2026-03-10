import type { FastifyReply } from 'fastify';
import { env } from '@config/env.js';
import { parseDurationMs } from '@libs/auth.js';

const isProduction = env.NODE_ENV === 'production';

// Cross-origin deployment: client and API on different subdomains require sameSite 'none'.
// Same-origin deployment (or local dev): 'strict' is the safest default.
const isCrossOrigin = Boolean(env.COOKIE_DOMAIN);
const sameSitePolicy = isProduction && isCrossOrigin ? 'none' as const : 'strict' as const;

// When set, cookies are shared across subdomains (e.g., ".example.com" covers app.example.com + api.example.com)
const cookieDomain = env.COOKIE_DOMAIN || undefined;

const ACCESS_TOKEN_MAX_AGE_MS = parseDurationMs(env.JWT_ACCESS_EXPIRY, 15 * 60 * 1000);
const REFRESH_TOKEN_MAX_AGE_MS = parseDurationMs(env.JWT_REFRESH_EXPIRY, 7 * 24 * 60 * 60 * 1000);

export function setAuthCookies(
  reply: FastifyReply,
  accessToken: string,
  refreshToken: string,
): void {
  reply.setCookie('access_token', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: sameSitePolicy,
    domain: cookieDomain,
    path: '/',
    maxAge: Math.floor(ACCESS_TOKEN_MAX_AGE_MS / 1000), // setCookie expects seconds
  });

  reply.setCookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: sameSitePolicy,
    domain: cookieDomain,
    path: '/api/v1/auth',
    maxAge: Math.floor(REFRESH_TOKEN_MAX_AGE_MS / 1000),
  });

  // Non-sensitive session indicator visible to Next.js middleware and client JS.
  // Lets middleware distinguish "never logged in" from "access token expired but session alive."
  reply.setCookie('auth_session', '1', {
    httpOnly: false,
    secure: isProduction,
    sameSite: sameSitePolicy,
    domain: cookieDomain,
    path: '/',
    maxAge: Math.floor(REFRESH_TOKEN_MAX_AGE_MS / 1000),
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie('access_token', {
    httpOnly: true,
    secure: isProduction,
    sameSite: sameSitePolicy,
    domain: cookieDomain,
    path: '/',
  });

  reply.clearCookie('refresh_token', {
    httpOnly: true,
    secure: isProduction,
    sameSite: sameSitePolicy,
    domain: cookieDomain,
    path: '/api/v1/auth',
  });

  reply.clearCookie('auth_session', {
    httpOnly: false,
    secure: isProduction,
    sameSite: sameSitePolicy,
    domain: cookieDomain,
    path: '/',
  });
}
