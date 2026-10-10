'use client';

import { useCallback, useRef } from 'react';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { useAppRouter } from '@/hooks/useAppRouter';
import { getErrorMessage, isErrorCode, ERROR_CODES } from '@/lib/utils/error';
import { ROUTES } from '@/lib/constants/routes';
import { getSafeRedirectPath } from '@/lib/utils/security';
import { authService } from '../services/auth.service';
import { setUser, setLoggingOut, logout as logoutAction } from '../store/authSlice';

import type { ILoginRequest, IRegisterRequest, IUser } from '../types/auth.types';

interface UseAuthReturn {
  user: IUser | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  login: (data: ILoginRequest, redirectTo?: string) => void;
  register: (data: IRegisterRequest) => void;
  logout: () => Promise<void>;
  isLoggingIn: boolean;
  isRegistering: boolean;
  isLoggingOut: boolean;
}

export const useAuth = (): UseAuthReturn => {
  const dispatch = useAppDispatch();
  const router = useAppRouter();
  const queryClient = useQueryClient();
  const { user, isAuthenticated, isInitializing, isLoggingOut } = useAppSelector((state) => state.auth);
  const pendingRedirectRef = useRef<string>(ROUTES.DASHBOARD);

  const loginMutation = useMutation({
    mutationFn: (data: ILoginRequest) => authService.login(data),
    onSuccess: (data) => {
      queryClient.clear();
      dispatch(setUser(data.user));
      toast.success('Signed in successfully');
      router.push(pendingRedirectRef.current);
    },
    onError: (error) => {
      if (isErrorCode(error, ERROR_CODES.ACCOUNT_DEACTIVATED)) {
        toast.error('This account has been deactivated. Contact support if you think this is a mistake.');
        return;
      }
      if (isErrorCode(error, ERROR_CODES.EMAIL_NOT_VERIFIED)) {
        toast.error('Please verify your email address before signing in.');
        return;
      }
      toast.error(getErrorMessage(error));
    },
  });

  const registerMutation = useMutation({
    mutationFn: (data: IRegisterRequest) => authService.register(data),
    onSuccess: (data) => {
      // No session is issued until the email is verified (server returns the
      // user with emailVerifiedAt = null when verification is required).
      if (!data.user.emailVerifiedAt) {
        toast.success('Account created! Please verify your email address to continue.');
        router.push(ROUTES.VERIFY_ACCOUNT);
        return;
      }
      queryClient.clear();
      dispatch(setUser(data.user));
      toast.success('Account created successfully');
      router.push(ROUTES.DASHBOARD);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });

  const logout = useCallback(async (): Promise<void> => {
    dispatch(setLoggingOut(true));
    try {
      await authService.logout();
    } catch {
      // Proceed with local logout even if server call fails
    } finally {
      queryClient.clear();
      dispatch(logoutAction());
      router.push(ROUTES.LOGIN);
    }
  }, [dispatch, router, queryClient]);

  return {
    user,
    isAuthenticated,
    isInitializing,
    login: (data: ILoginRequest, redirectTo?: string) => {
      // Validate again at the sink: whatever a caller passes, router.push after
      // login only ever receives a same-site path.
      const safeRedirect = getSafeRedirectPath(redirectTo);
      if (safeRedirect) {
        pendingRedirectRef.current = safeRedirect;
      }
      loginMutation.mutate(data);
    },
    register: registerMutation.mutate,
    logout,
    isLoggingIn: loginMutation.isPending,
    isRegistering: registerMutation.isPending,
    isLoggingOut,
  };
};
