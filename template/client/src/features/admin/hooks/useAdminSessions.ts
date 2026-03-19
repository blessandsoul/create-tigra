'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { getErrorMessage } from '@/lib/utils/error';
import { adminService } from '../services/admin.service';
import { adminKeys } from './useAdminUsers';

import type { IAdminSession, IGetSessionsParams } from '../types/admin.types';

// ─── Session List ───────────────────────────────────────────────────────────

interface UseAdminSessionsReturn {
  sessions: IAdminSession[];
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

export const useAdminSessions = (params: IGetSessionsParams = {}): UseAdminSessionsReturn => {
  const { data, isLoading, error } = useQuery({
    queryKey: adminKeys.sessionList(params),
    queryFn: () => adminService.getSessions(params),
  });

  return {
    sessions: data?.items ?? [],
    pagination: data?.pagination,
    isLoading,
    error,
  };
};

// ─── Force Expire Session ───────────────────────────────────────────────────

interface UseForceExpireSessionReturn {
  expireSession: (sessionId: string) => void;
  isExpiring: boolean;
}

export const useForceExpireSession = (): UseForceExpireSessionReturn => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (sessionId: string) => adminService.deleteSession(sessionId),
    onSuccess: () => {
      toast.success('Session expired successfully');
      queryClient.invalidateQueries({ queryKey: adminKeys.sessions() });
      queryClient.invalidateQueries({ queryKey: adminKeys.stats() });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });

  return {
    expireSession: mutation.mutate,
    isExpiring: mutation.isPending,
  };
};
