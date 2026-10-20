'use client';

import type React from 'react';
import { useEffect } from 'react';

import { usePathname } from 'next/navigation';

import { toast } from 'sonner';

import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { useAppRouter } from '@/hooks/useAppRouter';
import { onSessionEnded } from '@/lib/api/session-events';
import { ROUTES } from '@/lib/constants/routes';
import { isErrorCode, isLimitError, ERROR_CODES } from '@/lib/utils/error';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { logout } from '../store/authSlice';

const DEACTIVATED_MESSAGE = 'This account has been deactivated. Contact support if you think this is a mistake.';
// One toast however many places notice the ban at once.
const DEACTIVATED_TOAST_ID = 'account-deactivated';

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
  const router = useAppRouter();
  const dispatch = useAppDispatch();
  const { isLoggingOut } = useAppSelector((state) => state.auth);

  // The API client reports a session that ended (expired, absent at start-up,
  // or the account banned mid-session; lib/api/session-events.ts). Clear the
  // signed-in user so every screen shows the signed-out state at once.
  useEffect(
    () =>
      onSessionEnded((reason) => {
        dispatch(logout());
        if (reason === 'deactivated') toast.error(DEACTIVATED_MESSAGE, { id: DEACTIVATED_TOAST_ID });
      }),
    [dispatch]
  );

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
    // Rate limited or network blocked: the session may be fine, so stay put. The
    // global toast already says how long to wait (lib/api/axios.config.ts).
    if (isLimitError(error)) return;

    const status = (error as HttpLikeError)?.response?.status;
    if (status === 401 || status === 403) {
      if (isErrorCode(error, ERROR_CODES.ACCOUNT_DEACTIVATED)) {
        toast.error(DEACTIVATED_MESSAGE, { id: DEACTIVATED_TOAST_ID });
      } else if (isErrorCode(error, ERROR_CODES.EMAIL_NOT_VERIFIED)) {
        toast.error('Please verify your email address before signing in.');
      }
      router.push(ROUTES.LOGIN);
    }
  }, [error, pathname, router]);

  return <>{children}</>;
};
