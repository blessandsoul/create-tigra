/**
 * Users Routes
 *
 * Defines HTTP routes for user operations.
 */

import type { FastifyInstance } from 'fastify';
import { usersController } from './users.controller.js';
import { GetUserAvatarSchema } from './users.schemas.js';
import { authenticate } from '@libs/auth.js';

/**
 * Users routes plugin
 *
 * Endpoints:
 * - POST   /users/avatar       - Upload avatar (authenticated)
 * - DELETE /users/avatar       - Delete avatar (authenticated)
 * - GET    /users/:userId/avatar - Get avatar (public)
 *
 * @param fastify - Fastify instance
 */
export async function usersRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * Upload avatar
   *
   * POST /api/v1/users/avatar
   * Content-Type: multipart/form-data
   * Body: { file: File }
   * Auth: Required
   * Rate limit: 5 requests per minute
   */
  fastify.post(
    '/users/avatar',
    {
      preValidation: [authenticate],
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
        },
      },
    },
    usersController.uploadAvatar.bind(usersController)
  );

  /**
   * Delete avatar
   *
   * DELETE /api/v1/users/avatar
   * Auth: Required
   * Rate limit: 10 requests per minute
   */
  fastify.delete(
    '/users/avatar',
    {
      preValidation: [authenticate],
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    usersController.deleteAvatar.bind(usersController)
  );

  /**
   * Get user avatar
   *
   * GET /api/v1/users/:userId/avatar
   * Auth: Not required (public)
   * Rate limit: 100 requests per minute per IP
   */
  fastify.get<{ Params: { userId: string } }>(
    '/users/:userId/avatar',
    {
      schema: {
        params: GetUserAvatarSchema,
      },
      config: {
        rateLimit: {
          max: 100,
          timeWindow: '1 minute',
        },
      },
    },
    usersController.getAvatar.bind(usersController)
  );
}
