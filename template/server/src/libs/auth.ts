import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { env } from '@config/env.js';
import { UnauthorizedError, ForbiddenError } from '@shared/errors/errors.js';
import type { JwtPayload, UserRole } from '@shared/types/index.js';

let app: FastifyInstance | null = null;

export function initAuth(fastify: FastifyInstance): void {
  app = fastify;
}

function getApp(): FastifyInstance {
  if (!app) {
    throw new Error('Auth not initialized. Call initAuth(fastify) before using auth helpers.');
  }
  return app;
}

export function signAccessToken(payload: JwtPayload): string {
  return getApp().jwt.sign(
    { userId: payload.userId, role: payload.role },
    { expiresIn: env.JWT_ACCESS_EXPIRY },
  );
}

export function generateRefreshToken(): string {
  return uuidv4();
}

export function parseDurationMs(duration: string, fallbackMs: number): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return fallbackMs;

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}

export function getRefreshTokenExpiresAt(): Date {
  const ms = parseDurationMs(env.JWT_REFRESH_EXPIRY, 7 * 24 * 60 * 60 * 1000);
  return new Date(Date.now() + ms);
}

export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
}

export async function optionalAuth(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    // Not authenticated — that's okay for optional auth
  }
}

export function authorize(...roles: UserRole[]) {
  return async function authorizeHandler(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    if (!request.user) {
      throw new UnauthorizedError('Authentication required');
    }

    if (!roles.includes(request.user.role)) {
      throw new ForbiddenError('Insufficient permissions');
    }
  };
}

