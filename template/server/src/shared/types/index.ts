import type { FastifyRequest } from 'fastify';

export type UserRole = 'USER' | 'ADMIN';

export interface JwtPayload {
  userId: string;
  role: UserRole;
  /**
   * The login session this access token belongs to. authenticate() rejects the
   * token as soon as that session is gone (logout, logout-all, password change
   * or reset, admin revoke), instead of letting it live until it expires.
   * Tokens signed before this field existed lack it and are rejected.
   */
  sessionId: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    user: JwtPayload;
    startTime?: number; // Added for duration calculation
    targetUserId?: string;    // Set by resolveMe or resolveTargetUser middleware
    isAdminAction?: boolean;  // True when admin is acting on another user
  }
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: JwtPayload;
}
