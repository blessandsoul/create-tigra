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
import type { GetUserAvatarParams } from './users.schemas.js';
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

    // Get authenticated user ID
    const userId = request.user.userId;

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
    // Get authenticated user ID
    const userId = request.user.userId;

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
}

// Export singleton instance
export const usersController = new UsersController();
