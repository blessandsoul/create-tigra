'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { getErrorMessage } from '@/lib/utils/error';
import { adminService } from '../services/admin.service';

import type { IAdminUser, IAdminUserDetail, IGetUsersParams, IGetSessionsParams } from '../types/admin.types';

// ─── Query Key Factory ──────────────────────────────────────────────────────

export const adminKeys = {
  all: ['admin'] as const,
  stats: () => [...adminKeys.all, 'stats'] as const,
  users: () => [...adminKeys.all, 'users'] as const,
  userList: (params: IGetUsersParams) => [...adminKeys.users(), 'list', params] as const,
  userDetail: (userId: string) => [...adminKeys.users(), 'detail', userId] as const,
  sessions: () => [...adminKeys.all, 'sessions'] as const,
  sessionList: (params: IGetSessionsParams) => [...adminKeys.sessions(), 'list', params] as const,
};

// ─── User List ──────────────────────────────────────────────────────────────

interface UseAdminUsersReturn {
  users: IAdminUser[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  } | undefined;
  isLoading: boolean;
  error: Error | null;
}

export const useAdminUsers = (params: IGetUsersParams = {}): UseAdminUsersReturn => {
  const { data, isLoading, error } = useQuery({
    queryKey: adminKeys.userList(params),
    queryFn: () => adminService.getUsers(params),
  });

  return {
    users: data?.items ?? [],
    pagination: data?.pagination,
    isLoading,
    error,
  };
};

// ─── User Detail ────────────────────────────────────────────────────────────

interface UseAdminUserDetailReturn {
  user: IAdminUserDetail | undefined;
  isLoading: boolean;
  error: Error | null;
}

export const useAdminUserDetail = (userId: string): UseAdminUserDetailReturn => {
  const { data, isLoading, error } = useQuery({
    queryKey: adminKeys.userDetail(userId),
    queryFn: () => adminService.getUserDetail(userId),
    enabled: !!userId,
  });

  return {
    user: data,
    isLoading,
    error,
  };
};

// ─── Update User Status ─────────────────────────────────────────────────────

interface UseUpdateUserStatusReturn {
  updateStatus: (params: { userId: string; isActive: boolean }) => void;
  isUpdating: boolean;
}

export const useUpdateUserStatus = (): UseUpdateUserStatusReturn => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ userId, isActive }: { userId: string; isActive: boolean }) =>
      adminService.updateUserStatus(userId, { isActive }),
    onSuccess: (_data, variables) => {
      const action = variables.isActive ? 'activated' : 'deactivated';
      toast.success(`User ${action} successfully`);
      queryClient.invalidateQueries({ queryKey: adminKeys.users() });
      queryClient.invalidateQueries({ queryKey: adminKeys.stats() });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });

  return {
    updateStatus: mutation.mutate,
    isUpdating: mutation.isPending,
  };
};

// ─── Update User Role ───────────────────────────────────────────────────────

interface UseUpdateUserRoleReturn {
  updateRole: (params: { userId: string; role: 'USER' | 'ADMIN' }) => void;
  isUpdating: boolean;
}

export const useUpdateUserRole = (): UseUpdateUserRoleReturn => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'USER' | 'ADMIN' }) =>
      adminService.updateUserRole(userId, { role }),
    onSuccess: () => {
      toast.success('User role updated successfully');
      queryClient.invalidateQueries({ queryKey: adminKeys.users() });
      queryClient.invalidateQueries({ queryKey: adminKeys.stats() });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });

  return {
    updateRole: mutation.mutate,
    isUpdating: mutation.isPending,
  };
};
