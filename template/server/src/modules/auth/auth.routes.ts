import type { FastifyInstance } from 'fastify';
import { authenticate } from '@libs/auth.js';
import * as authController from './auth.controller.js';
import {
  registerSchema,
  loginSchema,
} from './auth.schemas.js';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // Register - Strict rate limiting to prevent abuse (5 requests per hour per IP)
  fastify.post('/auth/register', {
    schema: {
      body: registerSchema,
    },
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 hour',
      },
    },
    handler: authController.register,
  });

  // Login - Strict rate limiting to prevent brute force (10 requests per 15 minutes per IP)
  fastify.post('/auth/login', {
    schema: {
      body: loginSchema,
    },
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '15 minutes',
      },
    },
    handler: authController.login,
  });

  // Logout - reads refresh token from cookie, no body schema needed
  fastify.post('/auth/logout', {
    config: {
      rateLimit: {
        max: 50,
        timeWindow: '15 minutes',
      },
    },
    handler: authController.logout,
  });

  // Refresh token - reads refresh token from cookie, no body schema needed
  fastify.post('/auth/refresh', {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '15 minutes',
      },
    },
    handler: authController.refresh,
  });

  // Get current user
  fastify.get('/auth/me', {
    preValidation: [authenticate],
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute',
      },
    },
    handler: authController.me,
  });

  // Get user sessions
  fastify.get('/auth/sessions', {
    preValidation: [authenticate],
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
      },
    },
    handler: authController.getSessions,
  });

  // Logout from all sessions
  fastify.post('/auth/logout-all', {
    preValidation: [authenticate],
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '15 minutes',
      },
    },
    handler: authController.logoutAllSessions,
  });

}
