import axios from 'axios';

import type { InternalAxiosRequestConfig } from 'axios';

import { API_ENDPOINTS } from '@/lib/constants/api-endpoints';
import { ROUTES } from '@/lib/constants/routes';

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1',
  timeout: 30000,
  withCredentials: true, // Send cookies with every request
  headers: {
    'Content-Type': 'application/json',
  },
});

// No request interceptor needed — cookies are sent automatically

let isRefreshing = false;
let refreshTimestamp = 0;
const REFRESH_TIMEOUT_MS = 15000;
let failedQueue: { resolve: () => void; reject: (error: unknown) => void }[] = [];

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

    // Don't retry refresh endpoint itself
    if (originalRequest.url === API_ENDPOINTS.AUTH.REFRESH) {
      return Promise.reject(error);
    }

    // If a refresh is in progress but has exceeded the timeout, reset the stale flag
    if (isRefreshing && Date.now() - refreshTimestamp > REFRESH_TIMEOUT_MS) {
      processQueue(new Error('Token refresh timed out'));
      resetRefreshState();
    }

    if (isRefreshing) {
      return new Promise<void>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then(() => {
        return apiClient(originalRequest);
      });
    }

    originalRequest._retry = true;
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

      const { logout } = await import('@/features/auth/store/authSlice');
      const { store } = await import('@/store');
      store.dispatch(logout());

      if (typeof window !== 'undefined') {
        window.location.href = ROUTES.LOGIN;
      }

      return Promise.reject(refreshError);
    } finally {
      resetRefreshState();
    }
  }
);

export { apiClient };
