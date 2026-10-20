import { AUTH_PATHS, PROTECTED_PATHS } from '@/lib/constants/routes';

/**
 * Whether `pathname` is `base` itself or a page under it, by whole path
 * segments: '/admin' covers '/admin' and '/admin/users', never '/administrator'
 * (a plain startsWith would treat that unrelated page as protected).
 */
export function isUnderPath(pathname: string, base: string): boolean {
  if (pathname === base) return true;
  return pathname.startsWith(base.endsWith('/') ? base : `${base}/`);
}

/** A page that needs a signed-in visitor (PROTECTED_PATHS). */
export const isProtectedPath = (pathname: string): boolean =>
  PROTECTED_PATHS.some((base) => isUnderPath(pathname, base));

/** A sign-in page (AUTH_PATHS). */
export const isAuthPath = (pathname: string): boolean => AUTH_PATHS.some((base) => isUnderPath(pathname, base));
