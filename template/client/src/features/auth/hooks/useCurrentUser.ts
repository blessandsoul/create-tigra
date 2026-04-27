'use client';

import { useEffect } from 'react';

import { useQuery } from '@tanstack/react-query';

import { useAppDispatch } from '@/store/hooks';
import { authService } from '../services/auth.service';
import { setUser, setInitialized } from '../store/authSlice';

import type { IUser } from '../types/auth.types';

export const authKeys = {
  all: ['auth'] as const,
  me: () => [...authKeys.all, 'me'] as const,
};

interface UseCurrentUserOptions {
  enabled?: boolean;
}

interface UseCurrentUserReturn {
  user: IUser | undefined;
  isLoading: boolean;
  error: unknown;
}

export const useCurrentUser = (
  { enabled = true }: UseCurrentUserOptions = {}
): UseCurrentUserReturn => {
  const dispatch = useAppDispatch();

  const { data, isLoading, error } = useQuery({
    queryKey: authKeys.me(),
    queryFn: () => authService.getMe(),
    enabled,
    staleTime: 30 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (data) dispatch(setUser(data));
  }, [data, dispatch]);

  useEffect(() => {
    if (!enabled || error) dispatch(setInitialized());
  }, [enabled, error, dispatch]);

  return { user: data, isLoading, error };
};
