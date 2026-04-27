'use client';

import type React from 'react';
import { useEffect } from 'react';

import { usePathname, useRouter } from 'next/navigation';

import { toast } from 'sonner';

import { useAppSelector } from '@/store/hooks';
import { ROUTES } from '@/lib/constants/routes';
import { isErrorCode, ERROR_CODES } from '@/lib/utils/error';
import { useCurrentUser } from '../hooks/useCurrentUser';

const PROTECTED_PATHS: string[] = [ROUTES.DASHBOARD, ROUTES.PROFILE, '/admin'];

// Auth pages where getMe() should never fire — there is no session to hydrate
// on login/register/reset-password, and calling getMe() here would trigger the
// 401 → refresh → fail → redirect chain for no reason.
const AUTH_PATHS: string[] = [ROUTES.LOGIN, ROUTES.REGISTER, ROUTES.RESET_PASSWORD, ROUTES.VERIFY_ACCOUNT];

interface AuthInitializerProps {
  children: React.ReactNode;
}

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some((path) => pathname.startsWith(path));
}

function isAuthPage(pathname: string): boolean {
  return AUTH_PATHS.some((path) => pathname.startsWith(path));
}

interface HttpLikeError {
  response?: { status?: number };
}

export const AuthInitializer = ({ children }: AuthInitializerProps): React.ReactElement => {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoggingOut } = useAppSelector((state) => state.auth);

  // Skip getMe() on auth pages and during logout.
  // React Query handles deduping, refetch-on-focus, and invalidation —
  // any mutation that touches the current user (profile update, role change,
  // avatar upload, email verification) should call:
  //   queryClient.invalidateQueries({ queryKey: authKeys.me() })
  // to refresh Redux state automatically.
  const enabled = !isAuthPage(pathname) && !isLoggingOut;

  const { error } = useCurrentUser({ enabled });

  useEffect(() => {
    if (!error) return;
    if (!isProtectedPath(pathname)) return;

    const status = (error as HttpLikeError)?.response?.status;
    if (status === 401 || status === 403) {
      if (isErrorCode(error, ERROR_CODES.ACCOUNT_NOT_ACTIVE)) {
        toast.error('Your account is not yet activated. Please verify your account.');
      }
      router.push(ROUTES.LOGIN);
    }
  }, [error, pathname, router]);

  return <>{children}</>;
};
