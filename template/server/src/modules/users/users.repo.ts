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
   * Updates a user's avatar URL
   */
  async updateUserAvatar(userId: string, avatarUrl: string): Promise<SafeUser> {
    return prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: userSelect,
    });
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
}

// Export singleton instance
export const usersRepository = new UsersRepository();
