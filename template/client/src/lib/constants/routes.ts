export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  REGISTER: '/register',
  VERIFY_ACCOUNT: '/verify-account',
  RESET_PASSWORD: '/reset-password',
  DASHBOARD: '/dashboard',
  PROFILE: '/profile',
  ADMIN: {
    DASHBOARD: '/admin',
    USERS: '/admin/users',
    USER_DETAIL: (userId: string) => `/admin/users/${userId}`,
    SESSIONS: '/admin/sessions',
  },
} as const;
