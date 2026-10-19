/**
 * Fingerprint of a bearer token, the only form a token is stored in.
 *
 * Refresh tokens (MySQL) and password-reset / email-verification tokens
 * (Redis) are stored as their SHA-256 here; the raw token exists only in the
 * user's cookie or email link. So anyone who can merely READ the database or
 * Redis (a stolen backup, a read-only reporting account, an SQL injection
 * elsewhere) cannot sign in as anybody with what they read.
 *
 * A fast hash is enough: these tokens are long random values (122-bit UUIDs,
 * 256-bit hex), not passwords, so there is nothing to brute-force. Lookup is
 * by equality of the fingerprint (an indexed column / a Redis key).
 */
import { createHash } from 'node:crypto';

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}
