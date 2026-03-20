export const API_ENDPOINTS = {
  AUTH: {
    REGISTER: '/auth/register',
    LOGIN: '/auth/login',
    LOGOUT: '/auth/logout',
    REFRESH: '/auth/refresh',
    ME: '/auth/me',
    FORGOT_PASSWORD: '/auth/forgot-password',
    RESET_PASSWORD: '/auth/reset-password',
  },
  USERS: {
    ME: '/users/me',
    UPDATE_ME: '/users/me',
    DELETE_ME: '/users/me',
  },
  ADMIN: {
    STATS: '/admin/stats',
    USERS: '/admin/users',
    USER_DETAIL: (userId: string) => `/admin/users/${userId}`,
    USER_STATUS: (userId: string) => `/admin/users/${userId}/status`,
    USER_ROLE: (userId: string) => `/admin/users/${userId}/role`,
    SESSIONS: '/admin/sessions',
    SESSION_DELETE: (sessionId: string) => `/admin/sessions/${sessionId}`,
  },
} as const;
