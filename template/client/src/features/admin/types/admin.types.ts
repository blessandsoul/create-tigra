import type { IUser } from '@/features/auth/types/auth.types';
import type { PaginationParams } from '@/lib/api/api.types';

// ─── Admin User ─────────────────────────────────────────────────────────────

export interface IAdminUser extends IUser {
  deletedAt: string | null;
  failedLoginAttempts: number;
  lockedUntil: string | null;
}

export interface IAdminUserDetail extends IAdminUser {
  sessionCount: number;
  lastLogin: string | null;
}

// ─── Admin Session ──────────────────────────────────────────────────────────

export interface IAdminSession {
  id: string;
  userId: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  lastActiveAt: string;
  expiresAt: string;
  createdAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
}

// ─── Dashboard Stats ────────────────────────────────────────────────────────

export interface IDashboardStats {
  totalUsers: number;
  activeUsers: number;
  adminCount: number;
  recentSignups: number;
  activeSessions: number;
}

// ─── Request Params ─────────────────────────────────────────────────────────

export interface IGetUsersParams extends PaginationParams {
  search?: string;
  role?: 'USER' | 'ADMIN';
  isActive?: boolean;
  sortBy?: 'createdAt' | 'email' | 'firstName';
  sortOrder?: 'asc' | 'desc';
}

export interface IGetSessionsParams extends PaginationParams {
  userId?: string;
}

export interface IUpdateUserStatusRequest {
  isActive: boolean;
}

export interface IUpdateUserRoleRequest {
  role: 'USER' | 'ADMIN';
}
