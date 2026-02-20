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
  }
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: JwtPayload;
}
