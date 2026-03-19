/**
 * Admin Repository
 *
 * Data access layer for admin-specific queries.
 */

import { prisma, isPrismaNotFound } from '@libs/prisma.js';

import type { UserRole } from '@shared/types/index.js';

// ─── Select Shapes ──────────────────────────────────────────────────────────

const adminUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  avatarUrl: true,
  isActive: true,
  deletedAt: true,
  failedLoginAttempts: true,
  lockedUntil: true,
  createdAt: true,
  updatedAt: true,
} as const;

const sessionUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
} as const;

// ─── Types ──────────────────────────────────────────────────────────────────

export type AdminUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  avatarUrl: string | null;
  isActive: boolean;
  deletedAt: Date | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AdminUserDetail = AdminUser & {
  sessionCount: number;
  lastLogin: Date | null;
};

export type AdminSession = {
  id: string;
  userId: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  lastActiveAt: Date;
  expiresAt: Date;
  createdAt: Date;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
};

export type DashboardStats = {
  totalUsers: number;
  activeUsers: number;
  adminCount: number;
  recentSignups: number;
  activeSessions: number;
};

// ─── Repository ─────────────────────────────────────────────────────────────

class AdminRepository {
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
    const { page, limit, search, role, isActive, sortBy, sortOrder } = params;
    const offset = (page - 1) * limit;

    const where: Record<string, unknown> = {
      deletedAt: null,
    };

    if (search) {
      where.OR = [
        { email: { contains: search } },
        { firstName: { contains: search } },
        { lastName: { contains: search } },
      ];
    }

    if (role) {
      where.role = role;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [items, totalItems] = await Promise.all([
      prisma.user.findMany({
        where,
        select: adminUserSelect,
        orderBy: { [sortBy]: sortOrder },
        skip: offset,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return { items, totalItems };
  }

  /**
   * Lightweight user lookup for write operations (existence + role check).
   * Use getUserDetail() when you need session count and last login.
   */
  async findUserById(userId: string): Promise<AdminUser | null> {
    return prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: adminUserSelect,
    });
  }

  /**
   * Get detailed user info including session count and last login
   */
  async getUserDetail(userId: string): Promise<AdminUserDetail | null> {
    const now = new Date();

    const user = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: {
        ...adminUserSelect,
        _count: {
          select: {
            sessions: {
              where: { expiresAt: { gt: now } },
            },
          },
        },
      },
    });

    if (!user) return null;

    // Get last login from most recent session
    const latestSession = await prisma.session.findFirst({
      where: { userId },
      orderBy: { lastActiveAt: 'desc' },
      select: { lastActiveAt: true },
    });

    const { _count, ...userData } = user;

    return {
      ...userData,
      sessionCount: _count.sessions,
      lastLogin: latestSession?.lastActiveAt ?? null,
    };
  }

  /**
   * Update user active status
   */
  async updateUserStatus(userId: string, isActive: boolean): Promise<AdminUser> {
    return prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: adminUserSelect,
    });
  }

  /**
   * Update user role
   */
  async updateUserRole(userId: string, role: UserRole): Promise<AdminUser> {
    return prisma.user.update({
      where: { id: userId },
      data: { role },
      select: adminUserSelect,
    });
  }

  /**
   * Get dashboard statistics
   */
  async getDashboardStats(): Promise<DashboardStats> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [totalUsers, activeUsers, adminCount, recentSignups, activeSessions] =
      await Promise.all([
        prisma.user.count({ where: { deletedAt: null } }),
        prisma.user.count({ where: { deletedAt: null, isActive: true } }),
        prisma.user.count({ where: { deletedAt: null, role: 'ADMIN' } }),
        prisma.user.count({
          where: { deletedAt: null, createdAt: { gte: sevenDaysAgo } },
        }),
        prisma.session.count({ where: { expiresAt: { gt: now } } }),
      ]);

    return { totalUsers, activeUsers, adminCount, recentSignups, activeSessions };
  }

  /**
   * Get paginated list of active sessions with user info
   */
  async getAllSessions(params: {
    page: number;
    limit: number;
    userId?: string;
  }): Promise<{ items: AdminSession[]; totalItems: number }> {
    const { page, limit, userId } = params;
    const offset = (page - 1) * limit;
    const now = new Date();

    const where: Record<string, unknown> = {
      expiresAt: { gt: now },
    };

    if (userId) {
      where.userId = userId;
    }

    const [items, totalItems] = await Promise.all([
      prisma.session.findMany({
        where,
        include: { user: { select: sessionUserSelect } },
        orderBy: { lastActiveAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.session.count({ where }),
    ]);

    return { items, totalItems };
  }

  /**
   * Get session by ID with user info
   */
  async getSessionById(sessionId: string): Promise<AdminSession | null> {
    return prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: { select: sessionUserSelect } },
    });
  }

  /**
   * Delete a session (no-op if already deleted)
   */
  async deleteSession(sessionId: string): Promise<void> {
    try {
      await prisma.session.delete({ where: { id: sessionId } });
    } catch (error) {
      if (isPrismaNotFound(error)) return;
      throw error;
    }
  }

  /**
   * Delete refresh tokens linked to a specific session
   */
  async deleteRefreshTokensBySessionId(sessionId: string): Promise<void> {
    await prisma.refreshToken.deleteMany({ where: { sessionId } });
  }
}

export const adminRepository = new AdminRepository();
