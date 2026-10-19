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
import { NotFoundError, BadRequestError, ValidationError, ConflictError } from '@shared/errors/errors.js';
import { logger } from '@libs/logger.js';
import path from 'path';
import type { UpdateProfileInput, ChangePasswordInput, AdminChangePasswordInput } from './users.schemas.js';

/**
 * How often an upload retries pointing the database at its new file when a
 * parallel upload or delete keeps changing the avatar. Each retry means
 * someone else won a swap; 5 is plenty for one person's clicks and tabs.
 */
const AVATAR_SWAP_ATTEMPTS = 5;

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
   * 1. Optimize the image (bytes decide the format; WebP out, no metadata)
   * 2. Write it under a NEW random filename (the old avatar keeps serving)
   * 3. Point the database at it with a compare-and-swap, retrying when a
   *    parallel upload or delete changed the avatar in between
   * 4. Delete exactly the file this swap replaced
   *
   * Why the swap: two uploads at once (double click, two tabs) must end with
   * one file on disk, the one the database names. Each replaced URL is replaced
   * by exactly one swap, and only that upload deletes its file, so no upload
   * can delete a file another upload is about to point the database at.
   *
   * @param userId - User's unique ID
   * @param fileBuffer - Uploaded image buffer
   * @param originalFilename - Original filename (for logging)
   * @returns The new avatar URL
   * @throws NotFoundError if user not found
   * @throws ConflictError (AVATAR_BUSY) if the avatar kept changing during the upload
   */
  async uploadAvatar(
    userId: string,
    fileBuffer: Buffer,
    originalFilename: string
  ): Promise<{ avatarUrl: string }> {
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

    const optimizedBuffer = await imageOptimizerService.optimizeAvatar(fileBuffer);
    const { filename, url } = await fileStorageService.saveAvatar(userId, optimizedBuffer);

    // undefined = not swapped yet; null = swapped and there was no old avatar.
    let replaced: string | null | undefined;
    try {
      let expected = user.avatarUrl;
      for (let attempt = 0; attempt < AVATAR_SWAP_ATTEMPTS && replaced === undefined; attempt++) {
        if (await usersRepository.swapAvatarUrl(userId, expected, url)) {
          replaced = expected;
          break;
        }
        const current = await usersRepository.getUserById(userId);
        if (!current) throw new NotFoundError('User not found', 'USER_NOT_FOUND');
        expected = current.avatarUrl;
      }
    } catch (error) {
      await fileStorageService.removeAvatarFile(userId, filename);
      throw error;
    }
    if (replaced === undefined) {
      await fileStorageService.removeAvatarFile(userId, filename);
      throw new ConflictError('The avatar changed while uploading. Please try again.', 'AVATAR_BUSY');
    }

    if (replaced) {
      await fileStorageService.removeAvatarFile(userId, path.basename(replaced));
    }

    logger.info({ msg: 'Avatar upload complete', userId, avatarUrl: url });

    return { avatarUrl: url };
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
   * Updates a user's profile
   *
   * @param userId - User's unique ID
   * @param input - Fields to update (firstName, lastName)
   * @returns Updated user
   * @throws NotFoundError if user not found
   *
   * UpdateProfileSchema already guarantees at least one (trimmed, 2-100 char) field.
   */
  async updateProfile(userId: string, input: UpdateProfileInput): Promise<SafeUser> {
    const { firstName, lastName } = input;

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
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;

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
   * @throws ValidationError (422 INVALID_CURRENT_PASSWORD) if the current password is wrong
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
      // 422, not 401: the caller IS signed in, and a 401 would make the client
      // treat it as an expired session and run a pointless token refresh.
      if (!isValid) {
        throw new ValidationError('Current password is incorrect', 'INVALID_CURRENT_PASSWORD');
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
   * @throws ValidationError (422 INVALID_PASSWORD) if the password is wrong
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
      // 422, not 401 (see changePassword): a wrong confirmation is wrong input.
      if (!isValid) {
        throw new ValidationError('Incorrect password', 'INVALID_PASSWORD');
      }
    }

    logger.info({ msg: 'Soft-deleting user account', userId });

    // Also clears avatarUrl (the photo is removed just below).
    await usersRepository.softDeleteUser(userId);

    // Delete all sessions and refresh tokens
    await sessionRepository.deleteAllUserSessions(userId);
    await authRepo.deleteRefreshTokensByUserId(userId);

    // The avatar is PUBLIC (/uploads): remove it now, not at the 30-day purge,
    // so a deleted account's photo stops being reachable at once. A failure
    // must not undo the deletion: log it, the purge (files first) retries.
    // Private files stay until the purge, unreachable since the owner can no
    // longer sign in.
    try {
      await fileStorageService.deleteAvatar(userId);
    } catch (error) {
      logger.error({ err: error, msg: 'Account deleted but its public avatar could not be removed', userId });
    }

    logger.info({ msg: 'User account deleted', userId });
  }
}

// Export singleton instance
export const usersService = new UsersService();
