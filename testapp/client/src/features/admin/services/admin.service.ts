import { apiClient } from '@/lib/api/axios.config';
import { API_ENDPOINTS } from '@/lib/constants/api-endpoints';

import type { ApiResponse, PaginatedApiResponse } from '@/lib/api/api.types';
import type {
  IAdminUser,
  IAdminUserDetail,
  IAdminSession,
  IDashboardStats,
  IGetUsersParams,
  IGetSessionsParams,
  IUpdateUserStatusRequest,
  IUpdateUserRoleRequest,
} from '../types/admin.types';

interface PaginatedData<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

class AdminService {
  // ─── Dashboard Stats ────────────────────────────────────────────────

  async getDashboardStats(): Promise<IDashboardStats> {
    const response = await apiClient.get<ApiResponse<IDashboardStats>>(
      API_ENDPOINTS.ADMIN.STATS,
    );
    return response.data.data;
  }

  // ─── User Management ───────────────────────────────────────────────

  async getUsers(params?: IGetUsersParams): Promise<PaginatedData<IAdminUser>> {
    const response = await apiClient.get<PaginatedApiResponse<IAdminUser>>(
      API_ENDPOINTS.ADMIN.USERS,
      { params },
    );
    return response.data.data;
  }

  async getUserDetail(userId: string): Promise<IAdminUserDetail> {
    const response = await apiClient.get<ApiResponse<IAdminUserDetail>>(
      API_ENDPOINTS.ADMIN.USER_DETAIL(userId),
    );
    return response.data.data;
  }

  async updateUserStatus(
    userId: string,
    data: IUpdateUserStatusRequest,
  ): Promise<IAdminUser> {
    const response = await apiClient.patch<ApiResponse<IAdminUser>>(
      API_ENDPOINTS.ADMIN.USER_STATUS(userId),
      data,
    );
    return response.data.data;
  }

  async updateUserRole(
    userId: string,
    data: IUpdateUserRoleRequest,
  ): Promise<IAdminUser> {
    const response = await apiClient.patch<ApiResponse<IAdminUser>>(
      API_ENDPOINTS.ADMIN.USER_ROLE(userId),
      data,
    );
    return response.data.data;
  }

  // ─── Session Management ────────────────────────────────────────────

  async getSessions(
    params?: IGetSessionsParams,
  ): Promise<PaginatedData<IAdminSession>> {
    const response = await apiClient.get<PaginatedApiResponse<IAdminSession>>(
      API_ENDPOINTS.ADMIN.SESSIONS,
      { params },
    );
    return response.data.data;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await apiClient.delete(API_ENDPOINTS.ADMIN.SESSION_DELETE(sessionId));
  }
}

export const adminService = new AdminService();
