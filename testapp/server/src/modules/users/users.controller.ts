/**
 * Users Controller
 *
 * Request handlers for user endpoints.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import path from 'path';
import { usersService } from './users.service.js';
import { validateImageFile, validateFileSize } from '@libs/storage/file-validator.js';
import { successResponse } from '@shared/responses/successResponse.js';
import { clearAuthCookies } from '@libs/cookies.js';
import { ChangePasswordSchema, AdminChangePasswordSchema, DeleteAccountSchema } from './users.schemas.js';
import type { GetUserAvatarParams, UpdateProfileInput } from './users.schemas.js';
import type { AuthenticatedRequest } from '@shared/types/index.js';
import { logger } from '@libs/logger.js';
import { BadRequestError } from '@shared/errors/errors.js';

/**
 * Users Controller Class
 *
 * Handles HTTP requests for user operations.
 */
class UsersController {
  /**
   * Upload avatar handler
   *
   * POST /api/v1/users/avatar
   * Requires: multipart/form-data with file field
   * Auth: Required (JWT)
   *
   * @param request - Fastify request (authenticated)
   * @param reply - Fastify reply
   */
  async uploadAvatar(request: AuthenticatedRequest, reply: FastifyReply): Promise<void> {
    // Get uploaded file from multipart request
    const data = await request.file();

    if (!data) {
      throw new BadRequestError('No file uploaded', 'NO_FILE');
    }

    // Validate file (MIME type, extension)
    validateImageFile(data);

    // Read file buffer
    const buffer = await data.toBuffer();

    // Validate file size
    validateFileSize(buffer);

    // Get target user ID (set by resolveMe or resolveTargetUser middleware)
    const userId = request.targetUserId!;

    logger.info({
      msg: 'Avatar upload request',
      userId,
      filename: data.filename,
      mimetype: data.mimetype,
      size: buffer.length,
    });

    // Call service to process and save avatar
    const updatedUser = await usersService.uploadAvatar(userId, buffer, data.filename);

    return reply.send(
      successResponse('Avatar uploaded successfully', {
        avatarUrl: updatedUser.avatarUrl,
      })
    );
  }

  /**
   * Delete avatar handler
   *
   * DELETE /api/v1/users/avatar
   * Auth: Required (JWT)
   *
   * @param request - Fastify request (authenticated)
   * @param reply - Fastify reply
   */
  async deleteAvatar(request: AuthenticatedRequest, reply: FastifyReply): Promise<void> {
    // Get target user ID (set by resolveMe or resolveTargetUser middleware)
    const userId = request.targetUserId!;

    logger.info({ msg: 'Avatar delete request', userId });

    // Call service to delete avatar
    await usersService.deleteAvatar(userId);

    return reply.send(successResponse('Avatar deleted successfully', null));
  }

  /**
   * Get avatar handler
   *
   * GET /api/v1/users/:userId/avatar
   * Auth: Not required (public endpoint)
   *
   * Returns the avatar file directly or 404 if not found.
   *
   * @param request - Fastify request
   * @param reply - Fastify reply
   */
  async getAvatar(
    request: FastifyRequest<{ Params: GetUserAvatarParams }>,
    reply: FastifyReply
  ): Promise<void> {
    const { userId } = request.params;

    logger.info({ msg: 'Avatar fetch request', userId });

    // Get avatar file path
    const { path: filePath } = await usersService.getAvatar(userId);

    // Send file directly
    return reply.sendFile(path.basename(filePath), path.dirname(filePath));
  }

  /**
   * Update profile handler
   *
   * PATCH /api/v1/users/me
   * Auth: Required (JWT)
   *
   * @param request - Fastify request (authenticated)
   * @param reply - Fastify reply
   */
  async updateProfile(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const userId = request.targetUserId!;
    const body = request.body as UpdateProfileInput;

    logger.info({ msg: 'Update profile request', userId });

    const updatedUser = await usersService.updateProfile(userId, body);

    return reply.send(successResponse('Profile updated successfully', updatedUser));
  }

  /**
   * Change password handler
   *
   * PATCH /api/v1/users/me/password
   * Auth: Required (JWT)
   *
   * @param request - Fastify request (authenticated)
   * @param reply - Fastify reply
   */
  async changePassword(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const userId = request.targetUserId!;
    const isAdminAction = request.isAdminAction ?? false;

    if (isAdminAction) {
      const parsed = AdminChangePasswordSchema.parse(request.body);
      logger.info({ msg: 'Admin change password request', targetUserId: userId, adminUserId: request.user.userId });
      await usersService.changePassword(userId, parsed, true);
    } else {
      const parsed = ChangePasswordSchema.parse(request.body);
      logger.info({ msg: 'Change password request', userId });
      await usersService.changePassword(userId, parsed, false);
    }

    return reply.send(successResponse('Password changed successfully', null));
  }

  /**
   * Delete account handler
   *
   * DELETE /api/v1/users/me
   * Auth: Required (JWT)
   *
   * @param request - Fastify request (authenticated)
   * @param reply - Fastify reply
   */
  async deleteAccount(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const userId = request.targetUserId!;
    const isAdminAction = request.isAdminAction ?? false;

    if (isAdminAction) {
      logger.info({ msg: 'Admin delete account request', targetUserId: userId, adminUserId: request.user.userId });
      await usersService.deleteAccount(userId, '', true);
    } else {
      const parsed = DeleteAccountSchema.parse(request.body);
      logger.info({ msg: 'Delete account request', userId });
      await usersService.deleteAccount(userId, parsed.password, false);
    }

    // Only clear cookies if the user is deleting their OWN account
    if (!isAdminAction) {
      clearAuthCookies(reply);
    }

    return reply.send(successResponse('Account deleted successfully', null));
  }
}

// Export singleton instance
export const usersController = new UsersController();
