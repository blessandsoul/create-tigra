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

/**
 * Pages only a signed-in visitor may open, each with everything under it
 * (/admin also covers /admin/users, never /administrator; lib/utils/paths.ts).
 * The proxy sends a visitor with no session marker to sign-in, and
 * AuthInitializer does the same when the session turns out to be dead. The
 * template ships no pages: add your own protected areas here.
 */
export const PROTECTED_PATHS: readonly string[] = [ROUTES.DASHBOARD, ROUTES.PROFILE, ROUTES.ADMIN.DASHBOARD];

/** The sign-in pages, where the start-up "who am I" check never runs (no session to read there yet). */
export const AUTH_PATHS: readonly string[] = [ROUTES.LOGIN, ROUTES.REGISTER, ROUTES.RESET_PASSWORD, ROUTES.VERIFY_ACCOUNT];
