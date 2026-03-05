/**
 * Users Routes
 *
 * Defines HTTP routes for user operations.
 */

import type { FastifyInstance } from 'fastify';
import { usersController } from './users.controller.js';
import {
  GetUserAvatarSchema,
  UserIdParamSchema,
  UpdateProfileSchema,
  ChangePasswordSchema,
  DeleteAccountSchema,
} from './users.schemas.js';
import { authenticate, resolveMe, resolveTargetUser } from '@libs/auth.js';
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
 * - PATCH  /users/:userId         - Update profile (owner or admin)
 * - PATCH  /users/:userId/password - Change password (owner or admin)
 * - DELETE /users/:userId         - Delete account (owner or admin)
 * - POST   /users/:userId/avatar  - Upload avatar (owner or admin)
 * - DELETE /users/:userId/avatar  - Delete avatar (owner or admin)
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
      preValidation: [authenticate, resolveMe],
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
      preValidation: [authenticate, resolveMe],
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
      preValidation: [authenticate, resolveMe],
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
      preValidation: [authenticate, resolveMe],
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
      preValidation: [authenticate, resolveMe],
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

  // --- /users/:userId variants (owner or admin) ---

  /**
   * Update profile (by user ID)
   *
   * PATCH /api/v1/users/:userId
   * Body: { firstName?, lastName? }
   * Auth: Required (owner or admin)
   * Rate limit: 10 requests per minute
   */
  fastify.patch(
    '/users/:userId',
    {
      preValidation: [authenticate, resolveTargetUser],
      schema: {
        params: UserIdParamSchema,
        body: UpdateProfileSchema,
      },
      config: {
        rateLimit: RATE_LIMITS.USERS_UPDATE_PROFILE,
      },
    },
    usersController.updateProfile.bind(usersController)
  );

  /**
   * Change password (by user ID)
   *
   * PATCH /api/v1/users/:userId/password
   * Body (owner): { currentPassword, newPassword }
   * Body (admin): { newPassword }
   * Auth: Required (owner or admin)
   * Rate limit: 5 requests per minute
   */
  fastify.patch(
    '/users/:userId/password',
    {
      preValidation: [authenticate, resolveTargetUser],
      schema: {
        params: UserIdParamSchema,
      },
      config: {
        rateLimit: RATE_LIMITS.USERS_CHANGE_PASSWORD,
      },
    },
    usersController.changePassword.bind(usersController)
  );

  /**
   * Delete account (by user ID)
   *
   * DELETE /api/v1/users/:userId
   * Body (owner): { password }
   * Body (admin): empty
   * Auth: Required (owner or admin)
   * Rate limit: 3 requests per minute
   */
  fastify.delete(
    '/users/:userId',
    {
      preValidation: [authenticate, resolveTargetUser],
      schema: {
        params: UserIdParamSchema,
      },
      config: {
        rateLimit: RATE_LIMITS.USERS_DELETE_ACCOUNT,
      },
    },
    usersController.deleteAccount.bind(usersController)
  );

  /**
   * Upload avatar (by user ID)
   *
   * POST /api/v1/users/:userId/avatar
   * Content-Type: multipart/form-data
   * Body: { file: File }
   * Auth: Required (owner or admin)
   * Rate limit: 5 requests per minute
   */
  fastify.post(
    '/users/:userId/avatar',
    {
      preValidation: [authenticate, resolveTargetUser],
      schema: {
        params: UserIdParamSchema,
      },
      config: {
        rateLimit: RATE_LIMITS.USERS_UPLOAD_AVATAR,
      },
    },
    usersController.uploadAvatar.bind(usersController)
  );

  /**
   * Delete avatar (by user ID)
   *
   * DELETE /api/v1/users/:userId/avatar
   * Auth: Required (owner or admin)
   * Rate limit: 10 requests per minute
   */
  fastify.delete(
    '/users/:userId/avatar',
    {
      preValidation: [authenticate, resolveTargetUser],
      schema: {
        params: UserIdParamSchema,
      },
      config: {
        rateLimit: RATE_LIMITS.USERS_DELETE_AVATAR,
      },
    },
    usersController.deleteAvatar.bind(usersController)
  );
}
