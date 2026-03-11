'use client';

import type React from 'react';
import { useEffect } from 'react';

import { usePathname, useRouter } from 'next/navigation';

import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { ROUTES } from '@/lib/constants/routes';
import { authService } from '../services/auth.service';
import { setUser, setInitialized } from '../store/authSlice';

const PROTECTED_PATHS: string[] = [ROUTES.DASHBOARD, ROUTES.PROFILE];

interface AuthInitializerProps {
  children: React.ReactNode;
}

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some((path) => pathname.startsWith(path));
}

export const AuthInitializer = ({ children }: AuthInitializerProps): React.ReactElement => {
  const dispatch = useAppDispatch();
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, isLoggingOut } = useAppSelector((state) => state.auth);

  useEffect(() => {
    // On public pages, skip auth hydration — just mark as initialized
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
          router.push(ROUTES.LOGIN);
        }
      });

    return (): void => {
      cancelled = true;
    };
  }, [dispatch, pathname, isAuthenticated, isLoggingOut, router]);

  return <>{children}</>;
};
