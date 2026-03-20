import axios from 'axios';

import type { InternalAxiosRequestConfig } from 'axios';

import { API_ENDPOINTS } from '@/lib/constants/api-endpoints';
import { ROUTES } from '@/lib/constants/routes';
import { env } from '@/lib/env';

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

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

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
    const noRetryEndpoints: string[] = [
      API_ENDPOINTS.AUTH.LOGIN,
      API_ENDPOINTS.AUTH.REGISTER,
      API_ENDPOINTS.AUTH.REFRESH,
      API_ENDPOINTS.AUTH.RESET_PASSWORD,
    ];
    if (noRetryEndpoints.includes(originalRequest.url ?? '')) {
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
      processQueue(refreshError);

      // Only logout on definitive auth failures (server responded with 4xx).
      // Network errors (server unreachable, timeout) should NOT destroy the session.
      const isAuthFailure =
        axios.isAxiosError(refreshError) &&
        refreshError.response != null &&
        refreshError.response.status >= 400 &&
        refreshError.response.status < 500;

      if (isAuthFailure) {
        // Trip the circuit breaker FIRST — prevents any subsequent 401s
        // from re-entering this flow while the redirect is pending.
        isSessionDead = true;

        const { logout } = await import('@/features/auth/store/authSlice');
        const { store } = await import('@/store');
        store.dispatch(logout());

        if (typeof window !== 'undefined') {
          // Clear session indicator so middleware won't let user through
          // to protected pages — prevents redirect loops
          document.cookie = 'auth_session=; Max-Age=0; path=/; SameSite=Strict';
          window.location.href = ROUTES.LOGIN;
        }
      }

      return Promise.reject(refreshError);
    } finally {
      resetRefreshState();
    }
  }
);

export { apiClient };
