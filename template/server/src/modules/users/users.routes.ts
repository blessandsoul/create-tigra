/**
 * Users Routes
 *
 * Defines HTTP routes for user operations.
 */

import type { FastifyInstance } from 'fastify';
import { usersController } from './users.controller.js';
import {
  GetUserAvatarSchema,
  UpdateProfileSchema,
  ChangePasswordSchema,
  DeleteAccountSchema,
} from './users.schemas.js';
import { authenticate } from '@libs/auth.js';
import { RATE_LIMITS } from '@config/rate-limit.config.js';

/**
 * Users routes plugin
 *
 * Endpoints:
 * - PATCH  /users/me              - Update profile (authenticated)
 * - PATCH  /users/me/password     - Change password (authenticated)
 * - DELETE /users/me              - Delete account (authenticated)
 * - POST   /users/avatar          - Upload avatar (authenticated)
 * - DELETE /users/avatar          - Delete avatar (authenticated)
 * - GET    /users/:userId/avatar  - Get avatar (public)
 *
 * @param fastify - Fastify instance
 */
export async function usersRoutes(fastify: FastifyInstance): Promise<void> {
  // --- Profile Management ---

  /**
   * Update profile
   *
   * PATCH /api/v1/users/me
   * Body: { firstName?, lastName? }
   * Auth: Required
   * Rate limit: 10 requests per minute
   */
  fastify.patch(
    '/users/me',
    {
      preValidation: [authenticate],
      schema: {
        body: UpdateProfileSchema,
      },
      config: {
        rateLimit: RATE_LIMITS.USERS_UPDATE_PROFILE,
      },
    },
    usersController.updateProfile.bind(usersController)
  );

  /**
   * Change password
   *
   * PATCH /api/v1/users/me/password
   * Body: { currentPassword, newPassword }
   * Auth: Required
   * Rate limit: 5 requests per minute
   */
  fastify.patch(
    '/users/me/password',
    {
      preValidation: [authenticate],
      schema: {
        body: ChangePasswordSchema,
      },
      config: {
        rateLimit: RATE_LIMITS.USERS_CHANGE_PASSWORD,
      },
    },
    usersController.changePassword.bind(usersController)
  );

  /**
   * Delete account
   *
   * DELETE /api/v1/users/me
   * Body: { password }
   * Auth: Required
   * Rate limit: 3 requests per minute
   */
  fastify.delete(
    '/users/me',
    {
      preValidation: [authenticate],
      schema: {
        body: DeleteAccountSchema,
      },
      config: {
        rateLimit: RATE_LIMITS.USERS_DELETE_ACCOUNT,
      },
    },
    usersController.deleteAccount.bind(usersController)
  );

  // --- Avatar Management ---

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
        rateLimit: RATE_LIMITS.USERS_UPLOAD_AVATAR,
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
        rateLimit: RATE_LIMITS.USERS_DELETE_AVATAR,
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
        rateLimit: RATE_LIMITS.USERS_GET_AVATAR,
      },
    },
    usersController.getAvatar.bind(usersController)
  );
}
