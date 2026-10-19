/**
 * Users Repository
 *
 * Data access layer for user operations.
 */

import { prisma } from '@libs/prisma.js';
import type { UserRole } from '@shared/types/index.js';

/**
 * User selection fields (excludes sensitive data)
 */
const userSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  avatarUrl: true,
  isActive: true,
  emailVerifiedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type SafeUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  avatarUrl: string | null;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Users Repository Class
 *
 * Handles all database operations for users.
 */
class UsersRepository {
  /**
   * Gets a user by ID
   */
  async getUserById(userId: string): Promise<SafeUser | null> {
    return prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: userSelect,
    });
  }

  /**
   * Compare-and-swap of the avatar URL: sets `next` only if the stored URL is
   * still `expected` (null matches "no avatar"). Returns whether THIS call made
   * the change. One counted UPDATE, so of two parallel uploads exactly one
   * replaces any given URL, and only that one deletes the replaced file (see
   * usersService.uploadAvatar). Deleted accounts never match.
   */
  async swapAvatarUrl(userId: string, expected: string | null, next: string): Promise<boolean> {
    const { count } = await prisma.user.updateMany({
      where: { id: userId, deletedAt: null, avatarUrl: expected },
      data: { avatarUrl: next },
    });
    return count === 1;
  }

  /**
   * Clears a user's avatar URL
   */
  async clearUserAvatar(userId: string): Promise<SafeUser> {
    return prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
      select: userSelect,
    });
  }

  /**
   * Updates a user's profile fields
   */
  async updateUserProfile(
    userId: string,
    data: { firstName?: string; lastName?: string }
  ): Promise<SafeUser> {
    return prisma.user.update({
      where: { id: userId },
      data,
      select: userSelect,
    });
  }

  /**
   * Soft deletes a user: deletedAt set, isActive = false, and the avatar URL
   * cleared (its file is removed right after, see usersService.deleteAccount).
   */
  async softDeleteUser(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        isActive: false,
        avatarUrl: null,
      },
    });
  }
}

// Export singleton instance
export const usersRepository = new UsersRepository();
