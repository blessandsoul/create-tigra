'use client';

import type React from 'react';
import { useEffect } from 'react';

import { usePathname, useRouter } from 'next/navigation';

import { toast } from 'sonner';

import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { ROUTES } from '@/lib/constants/routes';
import { isErrorCode, ERROR_CODES } from '@/lib/utils/error';
import { authService } from '../services/auth.service';
import { setUser, setInitialized } from '../store/authSlice';

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

export const AuthInitializer = ({ children }: AuthInitializerProps): React.ReactElement => {
  const dispatch = useAppDispatch();
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, isLoggingOut } = useAppSelector((state) => state.auth);

  useEffect(() => {
    // On auth pages (login, register, etc.), never call getMe().
    // There is no session to hydrate, and a 401 here would trigger
    // the refresh → fail → redirect chain, causing an infinite loop.
    if (isAuthPage(pathname)) {
      dispatch(setInitialized());
      return;
    }

    // On other public pages, skip auth hydration — just mark as initialized
    if (!isProtectedPath(pathname)) {
      dispatch(setInitialized());
      return;
    }

    if (isAuthenticated || isLoggingOut) return;

    let cancelled = false;

    authService
      .getMe()
      .then((user) => {
        if (!cancelled) dispatch(setUser(user));
      })
      .catch((error) => {
        if (cancelled) return;
        dispatch(setInitialized());
        // Only redirect on auth errors (401/403), not network failures
        const status = error?.response?.status;
        if (status === 401 || status === 403) {
          if (isErrorCode(error, ERROR_CODES.ACCOUNT_NOT_ACTIVE)) {
            toast.error('Your account is not yet activated. Please verify your account.');
          }
          router.push(ROUTES.LOGIN);
        }
      });

    return (): void => {
      cancelled = true;
    };
  }, [dispatch, pathname, isAuthenticated, isLoggingOut, router]);

  return <>{children}</>;
};
