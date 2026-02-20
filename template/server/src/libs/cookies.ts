import type { FastifyReply } from 'fastify';
import { env } from '@config/env.js';
import { parseDurationMs } from '@libs/auth.js';

const isProduction = env.NODE_ENV === 'production';

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
    sameSite: 'strict',
    path: '/',
    maxAge: Math.floor(ACCESS_TOKEN_MAX_AGE_MS / 1000), // setCookie expects seconds
  });

  reply.setCookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: Math.floor(REFRESH_TOKEN_MAX_AGE_MS / 1000),
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie('access_token', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
  });

  reply.clearCookie('refresh_token', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/api/v1/auth',
  });
}
