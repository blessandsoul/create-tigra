'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { useAppDispatch } from '@/store/hooks';
import { getErrorMessage, isErrorCode, ERROR_CODES } from '@/lib/utils/error';
import { ROUTES } from '@/lib/constants/routes';
import { verificationService } from '../services/verification.service';
import { setUser } from '../store/authSlice';

interface UseSendVerificationReturn {
  sendVerification: (email: string) => void;
  isPending: boolean;
}

export const useSendVerification = (): UseSendVerificationReturn => {
  const router = useRouter();

  const mutation = useMutation({
    mutationFn: (email: string) => verificationService.sendVerification(email),
    onSuccess: () => {
      toast.success('Verification email sent! Please check your inbox.');
    },
    onError: (error: unknown) => {
      if (isErrorCode(error, ERROR_CODES.ALREADY_VERIFIED)) {
        toast.info('Your account is already verified');
        router.push(ROUTES.DASHBOARD);
        return;
      }
      toast.error(getErrorMessage(error));
    },
  });

  return {
    sendVerification: mutation.mutate,
    isPending: mutation.isPending,
  };
};

interface UseVerifyAccountReturn {
  verifyAccount: (token: string) => void;
  isPending: boolean;
}

export const useVerifyAccount = (): UseVerifyAccountReturn => {
  const dispatch = useAppDispatch();
  const router = useRouter();

  const mutation = useMutation({
    mutationFn: (token: string) => verificationService.verifyAccount(token),
    onSuccess: (data) => {
      dispatch(setUser(data.user));
      toast.success('Account verified successfully!');
      router.push(ROUTES.DASHBOARD);
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error));
      if (isErrorCode(error, ERROR_CODES.INVALID_VERIFICATION_TOKEN)) {
        router.push(ROUTES.LOGIN);
      }
    },
  });

  return {
    verifyAccount: mutation.mutate,
    isPending: mutation.isPending,
  };
};
