/**
 * The server's "signed in" marker: the auth_session cookie (value "1", not a
 * secret, readable by JavaScript; server src/libs/cookies.ts). It lives as long
 * as the refresh token, and in a split deployment (app. + api. subdomains) it
 * reaches the client only through COOKIE_DOMAIN, like everything that depends
 * on it, the proxy's protected-page check included.
 */
export const SESSION_MARKER_COOKIE = 'auth_session';

/**
 * Whether a cookie string holds the marker. Without it there is no session to
 * ask about, so the start-up "who am I" call is skipped and an anonymous
 * visitor makes no API calls at all. Defaults to this browser's cookies, and is
 * false during server rendering (no document).
 */
export function hasSessionMarker(
  cookies: string | undefined = typeof document === 'undefined' ? undefined : document.cookie
): boolean {
  if (!cookies) return false;
  return cookies.split(';').some((part) => {
    const [name, ...value] = part.trim().split('=');
    return name === SESSION_MARKER_COOKIE && value.join('=') !== '';
  });
}
