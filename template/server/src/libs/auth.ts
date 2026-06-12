import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { env } from '@config/env.js';
import { prisma } from '@libs/prisma.js';
import { UnauthorizedError, ForbiddenError, BadRequestError } from '@shared/errors/errors.js';
import { clearAuthCookies } from '@libs/cookies.js';
import { parseDurationMs } from '@libs/duration.js';
import type { JwtPayload, UserRole } from '@shared/types/index.js';

// Re-export so existing consumers of `parseDurationMs` from '@libs/auth.js'
// keep working. The implementation lives in the import-free leaf module
// duration.ts to avoid the cookies.ts ↔ auth.ts circular import (TDZ crash).
export { parseDurationMs } from '@libs/duration.js';

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

export function getRefreshTokenExpiresAt(): Date {
  const ms = parseDurationMs(env.JWT_REFRESH_EXPIRY, 7 * 24 * 60 * 60 * 1000);
  return new Date(Date.now() + ms);
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }

  // Verify user still exists, is active, and not soft-deleted.
  // When the session is definitively dead (user gone/deleted/inactive), clear auth
  // cookies on the response so the browser stops replaying stale credentials.
  // Without this, middleware keeps seeing the (still-unexpired) JWT cookie and
  // bounces /login → /dashboard → 401 → /login in an infinite loop.
  const user = await prisma.user.findUnique({
    where: { id: request.user.userId },
    select: { isActive: true, deletedAt: true },
  });

  if (!user || user.deletedAt) {
    clearAuthCookies(reply);
    throw new UnauthorizedError('Account is deactivated or deleted');
  }
  if (!user.isActive) {
    clearAuthCookies(reply);
    throw new ForbiddenError('Account is not activated. Please verify your account.', 'ACCOUNT_NOT_ACTIVE');
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

/**
 * Middleware: resolves targetUserId from the authenticated user's JWT.
 * Used for /users/me routes.
 * Must run AFTER authenticate.
 */
export async function resolveMe(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  request.targetUserId = request.user.userId;
  request.isAdminAction = false;
}

/**
 * Middleware: resolves targetUserId from :userId param.
 * Allows access if the authenticated user is the owner OR has ADMIN role.
 * Must run AFTER authenticate.
 *
 * Sets:
 * - request.targetUserId: the resolved user ID from params
 * - request.isAdminAction: true if admin is acting on a different user
 */
export async function resolveTargetUser(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const params = request.params as { userId?: string };
  const targetUserId = params.userId;

  if (!targetUserId) {
    throw new BadRequestError('Missing userId parameter', 'MISSING_USER_ID');
  }

  const isOwner = request.user.userId === targetUserId;
  const isAdmin = request.user.role === 'ADMIN';

  if (!isOwner && !isAdmin) {
    throw new ForbiddenError('You do not have permission to perform this action');
  }

  request.targetUserId = targetUserId;
  request.isAdminAction = !isOwner && isAdmin;
}

