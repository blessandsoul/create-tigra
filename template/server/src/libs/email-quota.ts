/**
 * Per-address email cap: at most EMAIL_PER_ADDRESS.max emails to one address per
 * window (default 3 per hour).
 *
 * Why per address and not only per IP: the route limits are per IP, so someone
 * with many IPs could otherwise flood one person's inbox and burn the sender's
 * reputation and quota.
 *
 * Two separate counters per address, so a stranger cannot use up the owner's emails:
 * - 'public': emails anyone can trigger by typing an address (forgot-password,
 *   the email-verification module's send-verification).
 * - 'sign-in': the verification link re-sent when an unverified user signs in
 *   with the RIGHT password. Only someone who knows the password reaches it, so
 *   anonymous requests never drain it; it still has its own cap, because whoever
 *   registered an address (and so knows its password) could otherwise flood it.
 * The single verification email sent at register is not capped at all: an
 * address can register only once, so it cannot be used to flood anyone.
 *
 * Rules that keep it from leaking which accounts exist:
 * - Call it BEFORE looking the user up, so unknown addresses are counted exactly
 *   like real ones and the 429 says nothing about the account.
 * - The counter key is a SHA-256 of the address, so Redis never stores raw emails.
 *
 * Redis down → the email is allowed (fail open), like the other limiters.
 */
import { createHash } from 'node:crypto';
import { EMAIL_PER_ADDRESS } from '@config/rate-limit.config.js';
import { getRedis } from '@libs/redis.js';
import { logger } from '@libs/logger.js';
import { TooManyRequestsError, describeWait } from '@shared/errors/errors.js';

/** Which counter an email is charged to (see the module header). */
export type EmailQuotaBucket = 'public' | 'sign-in';

const EMAIL_QUOTA_PREFIX: Record<EmailQuotaBucket, string> = {
  public: 'email-quota:',
  'sign-in': 'email-quota:sign-in:',
};

export function emailQuotaKey(email: string, bucket: EmailQuotaBucket = 'public'): string {
  return EMAIL_QUOTA_PREFIX[bucket] + createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

/**
 * Count one email to `email` in `bucket`. Throws 429 EMAIL_RATE_LIMITED (with
 * retryAfterSeconds) once that counter is over its quota for the window.
 */
export async function consumeEmailQuota(email: string, bucket: EmailQuotaBucket = 'public'): Promise<void> {
  const key = emailQuotaKey(email, bucket);
  let ttlMs: number;
  try {
    const redis = getRedis();
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.pexpire(key, EMAIL_PER_ADDRESS.timeWindow);
    }
    if (count <= EMAIL_PER_ADDRESS.max) return;
    ttlMs = await redis.pttl(key);
    if (ttlMs < 0) {
      // The expiry was lost (e.g. the PEXPIRE failed): restart the window rather than block forever.
      await redis.pexpire(key, EMAIL_PER_ADDRESS.timeWindow);
      ttlMs = EMAIL_PER_ADDRESS.timeWindow;
    }
  } catch {
    logger.warn('[EMAIL-QUOTA] Redis unavailable, sending without the per-address cap');
    return;
  }
  const seconds = Math.max(1, Math.ceil(ttlMs / 1000));
  throw new TooManyRequestsError(
    `Too many emails were sent to this address. Try again in ${describeWait(seconds)}.`,
    'EMAIL_RATE_LIMITED',
    seconds,
  );
}
