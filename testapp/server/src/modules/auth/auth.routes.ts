import type { FastifyInstance } from 'fastify';
import { authenticate } from '@libs/auth.js';
import { RATE_LIMITS } from '@config/rate-limit.config.js';
import * as authController from './auth.controller.js';
import {
  registerSchema,
  loginSchema,
} from './auth.schemas.js';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // Register - Strict rate limiting to prevent abuse
  fastify.post('/auth/register', {
    schema: {
      body: registerSchema,
    },
    config: {
      rateLimit: RATE_LIMITS.AUTH_REGISTER,
    },
    handler: authController.register,
  });

  // Login - Strict rate limiting to prevent brute force
  fastify.post('/auth/login', {
    schema: {
      body: loginSchema,
    },
    config: {
      rateLimit: RATE_LIMITS.AUTH_LOGIN,
    },
    handler: authController.login,
  });

  // Logout - reads refresh token from cookie, no body schema needed
  fastify.post('/auth/logout', {
    config: {
      rateLimit: RATE_LIMITS.AUTH_LOGOUT,
    },
    handler: authController.logout,
  });

  // Refresh token - reads refresh token from cookie, no body schema needed
  fastify.post('/auth/refresh', {
    config: {
      rateLimit: RATE_LIMITS.AUTH_REFRESH,
    },
    handler: authController.refresh,
  });

  // Get current user
  fastify.get('/auth/me', {
    preValidation: [authenticate],
    config: {
      rateLimit: RATE_LIMITS.AUTH_ME,
    },
    handler: authController.me,
  });

  // Get user sessions
  fastify.get('/auth/sessions', {
    preValidation: [authenticate],
    config: {
      rateLimit: RATE_LIMITS.AUTH_SESSIONS,
    },
    handler: authController.getSessions,
  });

  // Logout from all sessions
  fastify.post('/auth/logout-all', {
    preValidation: [authenticate],
    config: {
      rateLimit: RATE_LIMITS.AUTH_LOGOUT_ALL,
    },
    handler: authController.logoutAllSessions,
  });

}
