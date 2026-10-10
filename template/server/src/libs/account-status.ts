/**
 * Account status rules: one place that decides whether an existing, non-deleted
 * account may hold a session.
 *
 * Two independent states, deliberately kept apart:
 *  - `isActive`        — the admin ban switch. false = deactivated by an admin.
 *  - `emailVerifiedAt` — proof of email ownership. Required only while
 *                        REQUIRE_USER_VERIFICATION is on.
 *
 * They used to share one flag (`isActive=false` meant "banned" OR "not
 * verified yet"), which let a banned user re-activate themselves through the
 * email-verification link. Every place that issues or honours a session
 * (login, refresh, authenticate, verify-account) calls this helper so the rule
 * cannot drift between them.
 *
 * Callers must run it only AFTER the user has proven who they are (password,
 * valid token or refresh token): the distinct error codes would otherwise tell
 * an anonymous caller whether an email is banned or unverified.
 */

import { env } from '@config/env.js';
import { ForbiddenError } from '@shared/errors/errors.js';

export const ACCOUNT_DEACTIVATED = 'ACCOUNT_DEACTIVATED';
export const EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED';

export interface AccountStatus {
  isActive: boolean;
  emailVerifiedAt: Date | null;
}

/** True when the account still needs to verify its email before signing in. */
export function needsEmailVerification(user: Pick<AccountStatus, 'emailVerifiedAt'>): boolean {
  return env.REQUIRE_USER_VERIFICATION && !user.emailVerifiedAt;
}

/**
 * Throw a 403 when the account may not hold a session.
 * The ban check runs first: a banned account must never be told to "verify",
 * because verifying cannot (and must not) lift a ban.
 */
export function assertAccountCanSignIn(user: AccountStatus): void {
  if (!user.isActive) {
    throw new ForbiddenError(
      'This account has been deactivated. Contact support if you think this is a mistake.',
      ACCOUNT_DEACTIVATED,
    );
  }
  if (needsEmailVerification(user)) {
    throw new ForbiddenError('Please verify your email address before signing in.', EMAIL_NOT_VERIFIED);
  }
}
