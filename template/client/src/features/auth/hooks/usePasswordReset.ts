'use client';

import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useAppRouter } from '@/hooks/useAppRouter';
import { ROUTES } from '@/lib/constants/routes';
import { getErrorMessage, isLimitError } from '@/lib/utils/error';
import { authService } from '../services/auth.service';

interface UseForgotPasswordReturn {
  forgotPassword: (email: string) => void;
  isPending: boolean;
  /** Last error; ForgotPasswordForm shows rate-limit answers inline from it. */
  error: unknown;
}

export const useForgotPassword = (): UseForgotPasswordReturn => {
  const mutation = useMutation({
    mutationFn: (email: string) => authService.forgotPassword(email),
    onSuccess: () => {
      toast.success('Check your email for reset instructions');
    },
    onError: (error: unknown) => {
      // Rate limit / email cap: shown inline by ForgotPasswordForm, no toast.
      if (isLimitError(error)) return;
      toast.error(getErrorMessage(error));
    },
  });

  return {
    forgotPassword: mutation.mutate,
    isPending: mutation.isPending,
    error: mutation.error,
  };
};

interface UseResetPasswordReturn {
  resetPassword: (data: { token: string; newPassword: string }) => void;
  isPending: boolean;
}

export const useResetPassword = (): UseResetPasswordReturn => {
  const router = useAppRouter();

  const mutation = useMutation({
    mutationFn: (data: { token: string; newPassword: string }) =>
      authService.resetPassword(data.token, data.newPassword),
    onSuccess: () => {
      toast.success('Password reset successfully. Please sign in.');
      router.push(ROUTES.LOGIN);
    },
    onError: (error: unknown) => {
      if (isLimitError(error)) return; // the global toast already says how long to wait
      toast.error(getErrorMessage(error));
    },
  });

  return {
    resetPassword: mutation.mutate,
    isPending: mutation.isPending,
  };
};
