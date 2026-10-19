/**
 * Admin Service
 *
 * Business logic for admin operations.
 */

import { logger } from '@libs/logger.js';
import { NotFoundError, ForbiddenError, ConflictError } from '@shared/errors/errors.js';
import { RETENTION_DAYS } from '@/jobs/cleanup-deleted-accounts.job.js';
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
    deleted?: boolean;
  }): Promise<{ items: (AdminUser & { purgeAt?: Date })[]; totalItems: number }> {
    const result = await adminRepository.getUsers(params);
    if (!params.deleted) return result;
    // Deleted accounts say when the nightly purge removes them for good.
    return {
      ...result,
      items: result.items.map((user) => ({
        ...user,
        purgeAt: new Date(user.deletedAt!.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
      })),
    };
  }

  /**
   * Restore a soft-deleted account (before the purge removes it). It can sign
   * in again with its old password: isActive is set back to true, since the
   * deletion overwrote it (a ban from before the deletion is not kept; ban
   * again if needed). No sessions come back, and no avatar (removed at
   * deletion). The email was reserved while deleted, so it never conflicts.
   *
   * @throws NotFoundError 404 USER_NOT_FOUND if the account does not exist (or was purged)
   * @throws ConflictError 409 USER_NOT_DELETED if the account is not deleted
   */
  async restoreUser(userId: string): Promise<AdminUser> {
    if (!(await adminRepository.restoreUser(userId))) {
      if (!(await adminRepository.userExists(userId))) {
        throw new NotFoundError('User not found', 'USER_NOT_FOUND');
      }
      throw new ConflictError('This account is not deleted', 'USER_NOT_DELETED');
    }

    const user = await adminRepository.findUserById(userId);
    if (!user) throw new NotFoundError('User not found', 'USER_NOT_FOUND');

    logger.info({ msg: 'Deleted account restored', userId });
    return user;
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
   * Ban (isActive=false) or unban (isActive=true) a user.
   * Banning invalidates all sessions and refresh tokens. A ban can only be
   * lifted here: email verification no longer touches isActive.
   * Activating a user who never verified their email also approves the email,
   * so admins keep the ability to let a user in manually.
   * An admin can never ban themselves (like changing their own role): it would
   * end their own sessions and could leave the project with no admin at all.
   */
  async toggleUserStatus(userId: string, isActive: boolean, adminUserId: string): Promise<AdminUser> {
    if (!isActive && userId === adminUserId) {
      throw new ForbiddenError('You cannot ban your own account', 'CANNOT_BAN_SELF');
    }

    const user = await adminRepository.findUserById(userId);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const approveEmail = isActive && !user.emailVerifiedAt;
    const updatedUser = await adminRepository.updateUserStatus(userId, isActive, approveEmail);

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
