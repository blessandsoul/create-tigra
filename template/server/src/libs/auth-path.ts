import type { FastifyRequest } from 'fastify';

/**
 * Auth routes (login / register / refresh / ...) have their own per-route rate
 * limit and an account-lockout ladder. Their 429s must NOT feed the
 * cross-endpoint 1-hour IP auto-ban, or a user mistyping a password would lock
 * themselves out of the entire API (widget included).
 *
 * Exported for unit testing (auth-path.test.ts).
 */
export function isAuthPath(request: Pick<FastifyRequest, 'url'>): boolean {
  const pathname = request.url.split('?')[0];
  return pathname.startsWith('/api/v1/auth/');
}
