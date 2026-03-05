import type { FastifyRequest } from 'fastify';

export type UserRole = 'USER' | 'ADMIN';

export interface JwtPayload {
  userId: string;
  role: UserRole;
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
