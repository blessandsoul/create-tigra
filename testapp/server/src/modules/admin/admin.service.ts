/**
 * Admin Service
 *
 * Business logic for admin operations.
 */

import { logger } from '@libs/logger.js';
import { NotFoundError, ForbiddenError } from '@shared/errors/errors.js';
import { adminRepository } from './admin.repo.js';
import { sessionRepository } from '@modules/auth/session.repo.js';
import { deleteRefreshTokensByUserId } from '@modules/auth/auth.repo.js';

import type { UserRole } from '@shared/types/index.js';
import type { AdminUser, AdminUserDetail, AdminSession, DashboardStats } from './admin.repo.js';

class AdminService {
  /**
   * Get paginated list of users with optional filters
   */
  async getUsers(params: {
    page: number;
    limit: number;
    search?: string;
    role?: UserRole;
    isActive?: boolean;
    sortBy: 'createdAt' | 'email' | 'firstName';
    sortOrder: 'asc' | 'desc';
  }): Promise<{ items: AdminUser[]; totalItems: number }> {
    return adminRepository.getUsers(params);
  }

  /**
   * Get detailed user info
   */
  async getUserDetail(userId: string): Promise<AdminUserDetail> {
    const user = await adminRepository.getUserDetail(userId);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return user;
  }

  /**
   * Toggle user active status.
   * When deactivating, invalidates all sessions and refresh tokens.
   */
  async toggleUserStatus(userId: string, isActive: boolean): Promise<AdminUser> {
    const user = await adminRepository.findUserById(userId);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const updatedUser = await adminRepository.updateUserStatus(userId, isActive);

    if (!isActive) {
      // Force-logout: invalidate all sessions and refresh tokens
      const deletedSessions = await sessionRepository.deleteAllUserSessions(userId);
      await deleteRefreshTokensByUserId(userId);

      logger.info({
        msg: 'User deactivated and sessions invalidated',
        userId,
        deletedSessions,
      });
    } else {
      logger.info({ msg: 'User activated', userId });
    }

    return updatedUser;
  }

  /**
   * Change user role.
   * Prevents self-demotion. On demotion from ADMIN, invalidates sessions.
   */
  async changeUserRole(
    userId: string,
    role: UserRole,
    adminUserId: string,
  ): Promise<AdminUser> {
    if (userId === adminUserId) {
      throw new ForbiddenError('Cannot change your own role');
    }

    const user = await adminRepository.findUserById(userId);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const updatedUser = await adminRepository.updateUserRole(userId, role);

    // If demoting from ADMIN to USER, invalidate sessions so new role takes effect
    if (user.role === 'ADMIN' && role === 'USER') {
      const deletedSessions = await sessionRepository.deleteAllUserSessions(userId);
      await deleteRefreshTokensByUserId(userId);

      logger.info({
        msg: 'User demoted from ADMIN and sessions invalidated',
        userId,
        deletedSessions,
      });
    } else {
      logger.info({ msg: 'User role updated', userId, role });
    }

    return updatedUser;
  }

  /**
   * Get dashboard statistics
   */
  async getDashboardStats(): Promise<DashboardStats> {
    return adminRepository.getDashboardStats();
  }

  /**
   * Get paginated list of active sessions
   */
  async getAllSessions(params: {
    page: number;
    limit: number;
    userId?: string;
  }): Promise<{ items: AdminSession[]; totalItems: number }> {
    return adminRepository.getAllSessions(params);
  }

  /**
   * Force-expire a specific session.
   * Deletes the session and any associated refresh tokens.
   */
  async forceExpireSession(sessionId: string): Promise<void> {
    const session = await adminRepository.getSessionById(sessionId);

    if (!session) {
      throw new NotFoundError('Session not found');
    }

    // Delete refresh tokens linked to this session first
    await adminRepository.deleteRefreshTokensBySessionId(sessionId);
    await adminRepository.deleteSession(sessionId);

    logger.info({
      msg: 'Session force-expired by admin',
      sessionId,
      userId: session.userId,
    });
  }
}

export const adminService = new AdminService();
