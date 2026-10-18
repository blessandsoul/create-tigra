/**
 * Guard for features that cannot work without Redis: password-reset and
 * email-verification tokens live there, so while Redis is down those flows
 * cannot succeed (rate limits, lockout and blocks merely switch off instead).
 *
 * Call it FIRST, before looking anything up, so every caller gets the same
 * clear 503 SERVICE_UNAVAILABLE whatever the address. Failing later (after the
 * account lookup) would answer 500 for real accounts and the generic success for
 * unknown ones, which both looks broken and reveals who has an account.
 *
 * The check reads the client's connection state, no round trip: the client runs
 * with the offline queue off, so "not ready" means every command would fail now.
 */
import { getRedis } from '@libs/redis.js';
import { ServiceUnavailableError } from '@shared/errors/errors.js';

/** @param feature what the person asked for, e.g. "Password reset" (starts the message). */
export function assertRedisReady(feature: string): void {
  let ready: boolean;
  try {
    ready = getRedis().status === 'ready';
  } catch {
    ready = false; // the client could not even be created
  }
  if (!ready) {
    throw new ServiceUnavailableError(`${feature} is temporarily unavailable. Please try again in a few minutes.`);
  }
}
