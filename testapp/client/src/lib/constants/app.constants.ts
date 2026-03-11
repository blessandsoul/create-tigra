export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'My App';

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
} as const;

export const USER_ROLES = {
  USER: 'USER',
  ADMIN: 'ADMIN',
} as const;
