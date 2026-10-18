/**
 * Per-address email cap: at most EMAIL_PER_ADDRESS.max emails to one address per
 * window (default 3 per hour), shared by every flow that emails someone (forgot
 * password, the email-verification module's send-verification, register and the
 * sign-in resend).
 *
 * Why per address and not only per IP: the route limits are per IP, so someone
 * with many IPs could otherwise flood one person's inbox and burn the sender's
 * reputation and quota.
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

const EMAIL_QUOTA_PREFIX = 'email-quota:';

export function emailQuotaKey(email: string): string {
  return EMAIL_QUOTA_PREFIX + createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

/**
 * Count one email to `email`. Throws 429 EMAIL_RATE_LIMITED (with
 * retryAfterSeconds) once the address is over its quota for the window.
 */
export async function consumeEmailQuota(email: string): Promise<void> {
  const key = emailQuotaKey(email);
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
