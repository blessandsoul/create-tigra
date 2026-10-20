import axios from 'axios';
import { toast } from 'sonner';

import type { InternalAxiosRequestConfig } from 'axios';

import { hardRedirect } from '@/lib/api/hard-redirect';
import { emitSessionEnded } from '@/lib/api/session-events';
import { API_ENDPOINTS } from '@/lib/constants/api-endpoints';
import { ROUTES } from '@/lib/constants/routes';
import { env } from '@/lib/env';
import { ERROR_CODES, getLimitInfo, isErrorCode, isLimitError } from '@/lib/utils/error';

declare module 'axios' {
  interface AxiosRequestConfig {
    /**
     * Skip the global "too many requests" toast for this request because the
     * caller shows the message itself (the auth forms show it inline).
     */
    skipLimitToast?: boolean;
  }
}

// One fixed toast id: a burst of limited requests updates one toast instead of stacking many.
const LIMIT_TOAST_ID = 'rate-limit';

const apiClient = axios.create({
  baseURL: env.NEXT_PUBLIC_API_BASE_URL,
  timeout: 30000,
  withCredentials: true, // Send cookies with every request
});

// No request interceptor needed — cookies are sent automatically

let isRefreshing = false;
let refreshTimestamp = 0;
const REFRESH_TIMEOUT_MS = 15000;
let failedQueue: { resolve: () => void; reject: (error: unknown) => void }[] = [];

// Circuit breaker — once a refresh fails with a definitive auth error (4xx),
// this flag is set BEFORE dispatching logout or redirecting. All subsequent
// 401s are immediately rejected without entering the refresh flow, preventing
// the race condition where Redux state changes trigger re-renders that fire
// new API calls before the hard redirect completes.
// Resets automatically on page reload (window.location.href re-initializes the module).
let isSessionDead = false;

const processQueue = (error: unknown): void => {
  failedQueue.forEach((promise) => {
    if (error) {
      promise.reject(error);
    } else {
      promise.resolve();
    }
  });
  failedQueue = [];
};

const resetRefreshState = (): void => {
  isRefreshing = false;
  refreshTimestamp = 0;
};

// Calls that do not carry a session, so their 401 or 403 says nothing about one:
// a 401 there is wrong credentials or a bad token, and sign-in answers a banned
// account with 403 ACCOUNT_DEACTIVATED (the forms show that). Logout is here so
// ending a session never re-enters the session rules below.
const SESSIONLESS_ENDPOINTS: string[] = [
  API_ENDPOINTS.AUTH.LOGIN,
  API_ENDPOINTS.AUTH.REGISTER,
  API_ENDPOINTS.AUTH.REFRESH,
  API_ENDPOINTS.AUTH.RESET_PASSWORD,
  API_ENDPOINTS.AUTH.LOGOUT,
];

// One logout for a burst of calls that all found the account banned.
let endingDeactivatedSession: Promise<void> | null = null;

/**
 * The account was banned while signed in: every authenticated call now answers
 * 403 ACCOUNT_DEACTIVATED, and so would a refresh. End the session the way a
 * logout does (the server clears the cookies, auth_session with its cookie
 * domain included), then tell the app, which clears the user and says why.
 * Best effort: the user is signed out locally even if the logout call fails.
 */
const endDeactivatedSession = (): Promise<void> => {
  endingDeactivatedSession ??= apiClient
    .post(API_ENDPOINTS.AUTH.LOGOUT)
    .then(
      () => undefined,
      () => undefined
    )
    .then(() => {
      emitSessionEnded('deactivated');
    })
    .finally(() => {
      endingDeactivatedSession = null;
    });
  return endingDeactivatedSession;
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // "Slow down" answers (429 rate limit / login lock / email cap, 403 IP_BLOCKED):
    // tell the person once, with the wait time, and never treat them as an auth
    // failure. They are rejected as-is; React Query does not retry them (providers.tsx).
    const limit = getLimitInfo(error);
    if (limit) {
      if (!originalRequest?.skipLimitToast && typeof window !== 'undefined') {
        toast.error(limit.message, { id: LIMIT_TOAST_ID });
      }
      return Promise.reject(error);
    }

    const isSessionless = SESSIONLESS_ENDPOINTS.includes(originalRequest?.url ?? '');

    if (
      error.response?.status === 403 &&
      isErrorCode(error, ERROR_CODES.ACCOUNT_DEACTIVATED) &&
      !isSessionless
    ) {
      await endDeactivatedSession();
      return Promise.reject(error);
    }

    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    // Circuit breaker tripped — session is dead, redirect is pending.
    // Reject immediately without attempting refresh or queuing.
    if (isSessionDead) {
      return Promise.reject(error);
    }

    // Don't retry auth endpoints that don't use tokens —
    // a 401 here means wrong credentials, not an expired token.
    if (isSessionless) {
      return Promise.reject(error);
    }

    // If a refresh is in progress but has exceeded the timeout, reset the stale flag
    if (isRefreshing && Date.now() - refreshTimestamp > REFRESH_TIMEOUT_MS) {
      processQueue(new Error('Token refresh timed out'));
      resetRefreshState();
    }

    originalRequest._retry = true;

    if (isRefreshing) {
      return new Promise<void>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then(() => {
        return apiClient(originalRequest);
      });
    }
    isRefreshing = true;
    refreshTimestamp = Date.now();

    try {
      // Refresh — cookie is sent automatically
      await apiClient.post(API_ENDPOINTS.AUTH.REFRESH);

      processQueue(null);

      // Retry original request — new cookie is set automatically
      return apiClient(originalRequest);
    } catch (refreshError) {
      // Lost a race with another tab: both refreshed at once with the same
      // token, the other one won, and the server kept the cookies, so this
      // browser already holds the winner's fresh ones (401
      // REFRESH_TOKEN_ROTATED, server auth.controller.ts). Not a dead session:
      // release the queue and replay the request once with the new cookies.
      // `_retry` is already set, so a second 401 is rejected, never looped.
      if (isErrorCode(refreshError, ERROR_CODES.REFRESH_TOKEN_ROTATED)) {
        processQueue(null);
        return apiClient(originalRequest);
      }

      processQueue(refreshError);

      // Only logout on definitive auth failures (server responded with 4xx).
      // Network errors (server unreachable, timeout) should NOT destroy the session,
      // and neither should a rate-limited or blocked refresh: the session is still
      // valid, the caller just has to wait (the toast says how long).
      const isAuthFailure =
        axios.isAxiosError(refreshError) &&
        refreshError.response != null &&
        refreshError.response.status >= 400 &&
        refreshError.response.status < 500 &&
        !isLimitError(refreshError);

      if (isAuthFailure) {
        // The bootstrap probe (AuthInitializer's getMe) runs on EVERY page,
        // including public ones. For an anonymous visitor, getMe 401 →
        // refresh 401 is the NORMAL "not logged in" outcome — not a dead
        // session. The probe must fail silently to "anonymous": clear any
        // stale Redux state, but never trip the circuit breaker, clear the
        // session cookie, or hard-redirect a visitor off a public page.
        // (On protected pages, AuthInitializer handles the redirect itself.)
        // Note: a genuine request queued behind a probe-initiated refresh is
        // rejected via processQueue without tripping the breaker or
        // redirecting — AuthInitializer covers the redirect on protected pages.
        const isBootstrapProbe = originalRequest.url === API_ENDPOINTS.AUTH.ME;

        if (!isBootstrapProbe) {
          // A genuine authenticated action failed mid-session — the session
          // is dead. Trip the circuit breaker FIRST — prevents any subsequent
          // 401s from re-entering this flow while the redirect is pending.
          isSessionDead = true;
        }

        // AuthInitializer clears the signed-in user on this event.
        emitSessionEnded(isBootstrapProbe ? 'signed-out' : 'expired');

        if (!isBootstrapProbe && typeof window !== 'undefined') {
          // Clear the session marker so the proxy won't let the user through to
          // protected pages (prevents redirect loops). The server already
          // cleared it, with its cookie domain, when it refused the refresh;
          // this covers a host-only marker too.
          document.cookie = 'auth_session=; Max-Age=0; path=/; SameSite=Strict';
          hardRedirect(ROUTES.LOGIN);
        }
      }

      return Promise.reject(refreshError);
    } finally {
      resetRefreshState();
    }
  }
);

export { apiClient };
