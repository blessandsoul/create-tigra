/**
 * Users Service
 *
 * Business logic for user operations.
 */

import { usersRepository } from './users.repo.js';
import type { SafeUser } from './users.repo.js';
import * as authRepo from '@modules/auth/auth.repo.js';
import { sessionRepository } from '@modules/auth/session.repo.js';
import { fileStorageService } from '@libs/storage/file-storage.service.js';
import { imageOptimizerService } from '@libs/storage/image-optimizer.service.js';
import { verifyPassword, hashPassword } from '@libs/password.js';
import { NotFoundError, BadRequestError, UnauthorizedError } from '@shared/errors/errors.js';
import { logger } from '@libs/logger.js';
import path from 'path';
import type { UpdateProfileInput, ChangePasswordInput, AdminChangePasswordInput } from './users.schemas.js';

/**
 * Users Service Class
 *
 * Handles business logic for user profile and avatar operations.
 */
class UsersService {
  /**
   * Uploads and sets a user's avatar
   *
   * Process:
   * 1. Get user from database (need first/last name for SEO filename)
   * 2. Optimize image (resize, compress, convert to WebP)
   * 3. Generate SEO-friendly filename
   * 4. Save to user-specific directory
   * 5. Update user record with avatar URL
   *
   * @param userId - User's unique ID
   * @param fileBuffer - Uploaded image buffer
   * @param originalFilename - Original filename (for logging)
   * @returns Updated user with new avatar URL
   * @throws NotFoundError if user not found
   */
  async uploadAvatar(
    userId: string,
    fileBuffer: Buffer,
    originalFilename: string
  ): Promise<SafeUser> {
    // Get current user
    const user = await usersRepository.getUserById(userId);
    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    logger.info({
      msg: 'Processing avatar upload',
      userId,
      originalFilename,
      fileSize: fileBuffer.length,
    });

    // Optimize image (resize, compress, convert to WebP)
    const optimizedBuffer = await imageOptimizerService.optimizeAvatar(fileBuffer);

    // Save to user-specific directory with SEO-friendly filename
    const { filename, url } = await fileStorageService.saveAvatar(
      userId,
      optimizedBuffer,
      user.firstName,
      user.lastName
    );

    logger.info({
      msg: 'Avatar file saved',
      userId,
      filename,
      url,
    });

    // Update user record with avatar URL
    const updatedUser = await usersRepository.updateUserAvatar(userId, url);

    logger.info({ msg: 'Avatar upload complete', userId, avatarUrl: url });

    return updatedUser;
  }

  /**
   * Deletes a user's avatar
   *
   * Process:
   * 1. Get user from database
   * 2. Verify user has an avatar
   * 3. Delete avatar directory from file system
   * 4. Clear avatar URL in database
   *
   * @param userId - User's unique ID
   * @throws NotFoundError if user not found
   * @throws BadRequestError if user has no avatar to delete
   */
  async deleteAvatar(userId: string): Promise<void> {
    // Get current user
    const user = await usersRepository.getUserById(userId);
    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    // Check if user has an avatar
    if (!user.avatarUrl) {
      throw new BadRequestError('User has no avatar to delete', 'NO_AVATAR');
    }

    logger.info({ msg: 'Deleting user avatar', userId, avatarUrl: user.avatarUrl });

    // Delete avatar directory and all contents
    await fileStorageService.deleteAvatar(userId);

    // Clear avatar URL in database
    await usersRepository.clearUserAvatar(userId);

    logger.info({ msg: 'Avatar deleted successfully', userId });
  }

  /**
   * Gets a user's avatar file path
   *
   * Process:
   * 1. Get user from database
   * 2. Verify user has an avatar
   * 3. Extract filename from avatar URL
   * 4. Build and verify file path
   *
   * @param userId - User's unique ID
   * @returns Absolute file path and public URL
   * @throws NotFoundError if user not found or has no avatar
   */
  async getAvatar(userId: string): Promise<{ path: string; url: string }> {
    // Get user
    const user = await usersRepository.getUserById(userId);
    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    // Check if user has an avatar
    if (!user.avatarUrl) {
      throw new NotFoundError('User has no avatar', 'NO_AVATAR');
    }

    // Extract filename from URL (last segment)
    // URL format: /uploads/users/{userId}/avatar/{filename}
    const filename = path.basename(user.avatarUrl);

    // Build full file path
    const filePath = fileStorageService.getAvatarPath(userId, filename);

    // Verify file exists on disk
    const exists = await fileStorageService.fileExists(filePath);
    if (!exists) {
      logger.error({
        msg: 'Avatar file missing from disk',
        userId,
        avatarUrl: user.avatarUrl,
        filePath,
      });
      throw new NotFoundError('Avatar file not found on disk', 'AVATAR_FILE_NOT_FOUND');
    }

    return {
      path: filePath,
      url: user.avatarUrl,
    };
  }

  /**
   * Updates a user's profile
   *
   * @param userId - User's unique ID
   * @param input - Fields to update (firstName, lastName)
   * @returns Updated user
   * @throws NotFoundError if user not found
   * @throws BadRequestError if no fields provided
   */
  async updateProfile(userId: string, input: UpdateProfileInput): Promise<SafeUser> {
    const { firstName, lastName } = input;
    if (!firstName && !lastName) {
      throw new BadRequestError('At least one field must be provided', 'INVALID_INPUT');
    }

    const user = await usersRepository.getUserById(userId);
    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    logger.info({
      msg: 'Updating user profile',
      userId,
      fields: Object.keys(input).filter(k => input[k as keyof UpdateProfileInput] !== undefined),
    });

    const updateData: { firstName?: string; lastName?: string } = {};
    if (firstName) updateData.firstName = firstName;
    if (lastName) updateData.lastName = lastName;

    const updatedUser = await usersRepository.updateUserProfile(userId, updateData);

    logger.info({ msg: 'User profile updated', userId });

    return updatedUser;
  }

  /**
   * Changes a user's password
   *
   * @param userId - User's unique ID
   * @param input - Current and new password
   * @throws NotFoundError if user not found
   * @throws UnauthorizedError if current password is wrong
   * @throws BadRequestError if new password same as current
   */
  async changePassword(
    userId: string,
    input: ChangePasswordInput | AdminChangePasswordInput,
    skipPasswordVerification: boolean = false
  ): Promise<void> {
    const user = await authRepo.findUserById(userId);
    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    if (!skipPasswordVerification) {
      const fullInput = input as ChangePasswordInput;
      const isValid = await verifyPassword(fullInput.currentPassword, user.password);
      if (!isValid) {
        throw new UnauthorizedError('Current password is incorrect', 'INVALID_CREDENTIALS');
      }
    }

    const isSamePassword = await verifyPassword(input.newPassword, user.password);
    if (isSamePassword) {
      throw new BadRequestError('New password must be different from current password', 'SAME_PASSWORD');
    }

    const hashedPassword = await hashPassword(input.newPassword);
    await authRepo.updateUserPassword(userId, hashedPassword);

    logger.info({ msg: 'User password changed', userId });

    // Security: invalidate all sessions and refresh tokens
    await sessionRepository.deleteAllUserSessions(userId);
    await authRepo.deleteRefreshTokensByUserId(userId);

    logger.info({ msg: 'All sessions invalidated after password change', userId });
  }

  /**
   * Soft-deletes a user account
   *
   * @param userId - User's unique ID
   * @param password - Password confirmation
   * @throws NotFoundError if user not found
   * @throws UnauthorizedError if password is wrong
   */
  async deleteAccount(
    userId: string,
    password: string,
    skipPasswordVerification: boolean = false
  ): Promise<void> {
    const user = await authRepo.findUserById(userId);
    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    if (!skipPasswordVerification) {
      const isValid = await verifyPassword(password, user.password);
      if (!isValid) {
        throw new UnauthorizedError('Incorrect password', 'INVALID_CREDENTIALS');
      }
    }

    logger.info({ msg: 'Soft-deleting user account', userId });

    await usersRepository.softDeleteUser(userId);

    // Delete all sessions and refresh tokens
    await sessionRepository.deleteAllUserSessions(userId);
    await authRepo.deleteRefreshTokensByUserId(userId);

    logger.info({ msg: 'User account deleted', userId });
  }
}

// Export singleton instance
export const usersService = new UsersService();
