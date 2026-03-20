'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { ROUTES } from '@/lib/constants/routes';
import { getErrorMessage } from '@/lib/utils/error';
import { authService } from '../services/auth.service';

interface UseForgotPasswordReturn {
  forgotPassword: (email: string) => void;
  isPending: boolean;
}

export const useForgotPassword = (): UseForgotPasswordReturn => {
  const mutation = useMutation({
    mutationFn: (email: string) => authService.forgotPassword(email),
    onSuccess: () => {
      toast.success('Check your email for reset instructions');
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error));
    },
  });

  return {
    forgotPassword: mutation.mutate,
    isPending: mutation.isPending,
  };
};

interface UseResetPasswordReturn {
  resetPassword: (data: { token: string; newPassword: string }) => void;
  isPending: boolean;
}

export const useResetPassword = (): UseResetPasswordReturn => {
  const router = useRouter();

  const mutation = useMutation({
    mutationFn: (data: { token: string; newPassword: string }) =>
      authService.resetPassword(data.token, data.newPassword),
    onSuccess: () => {
      toast.success('Password reset successfully. Please sign in.');
      router.push(ROUTES.LOGIN);
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error));
    },
  });

  return {
    resetPassword: mutation.mutate,
    isPending: mutation.isPending,
  };
};
