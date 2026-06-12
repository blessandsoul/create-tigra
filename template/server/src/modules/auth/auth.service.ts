import crypto from 'node:crypto';
import { signAccessToken, generateRefreshToken, getRefreshTokenExpiresAt } from '@libs/auth.js';
import { hashPassword, verifyPassword } from '@libs/password.js';
import { getRedis } from '@libs/redis.js';
import { sendEmail } from '@libs/email.js';
import { logger } from '@libs/logger.js';
import { env } from '@config/env.js';
import {
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  BadRequestError,
} from '@shared/errors/errors.js';
import type { UserRole } from '@shared/types/index.js';
import * as authRepo from './auth.repo.js';
import { sessionRepository } from './session.repo.js';
import type { RegisterInput, LoginInput } from './auth.schemas.js';

const PASSWORD_RESET_TTL = 3600; // 1 hour in seconds
const PASSWORD_RESET_PREFIX = 'pw-reset:';
const PASSWORD_RESET_USER_PREFIX = 'pw-reset-user:';

// --- Account lockout (scoped to email + IP) ---
// Failed-login attempts are tracked in Redis keyed by the (email, IP) PAIR.
// Keying by email alone let anyone lock a victim out remotely by spamming bad
// passwords at the victim's email (lockout DoS). Scoped to email+IP, an
// attacker only ever locks out their own address; distributed attempts are
// still throttled by the per-IP rate limit on the login route.
// Redis failures fail OPEN (no lockout) — consistent with ip-block.ts:
// availability over lockout, and rate limiting still applies.
const LOGIN_FAIL_PREFIX = 'login-fail:';
const LOGIN_LOCK_PREFIX = 'login-lock:';
const LOGIN_FAIL_WINDOW_SECONDS = 60 * 60; // failed attempts expire after 1 hour

// Account lockout configuration
const LOCKOUT_THRESHOLDS = [
  { attempts: 5, durationMs: 15 * 60 * 1000 },   // 5 failures → 15 min
  { attempts: 10, durationMs: 30 * 60 * 1000 },   // 10 failures → 30 min
  { attempts: 15, durationMs: 60 * 60 * 1000 },   // 15+ failures → 1 hour
];

function getLockoutDuration(failedAttempts: number): number | null {
  for (let i = LOCKOUT_THRESHOLDS.length - 1; i >= 0; i--) {
    if (failedAttempts >= LOCKOUT_THRESHOLDS[i].attempts) {
      return LOCKOUT_THRESHOLDS[i].durationMs;
    }
  }
  return null;
}

function lockoutKey(prefix: string, email: string, ipAddress?: string): string {
  return `${prefix}${email.toLowerCase()}:${ipAddress ?? 'unknown'}`;
}

async function isLoginLocked(email: string, ipAddress?: string): Promise<boolean> {
  try {
    const locked = await getRedis().exists(lockoutKey(LOGIN_LOCK_PREFIX, email, ipAddress));
    return locked === 1;
  } catch {
    return false; // fail open — Redis down must not block all logins
  }
}

async function recordFailedLogin(email: string, ipAddress?: string): Promise<void> {
  try {
    const redis = getRedis();
    const failKey = lockoutKey(LOGIN_FAIL_PREFIX, email, ipAddress);

    const attempts = await redis.incr(failKey);
    if (attempts === 1) {
      await redis.expire(failKey, LOGIN_FAIL_WINDOW_SECONDS);
    }

    const lockDurationMs = getLockoutDuration(attempts);
    if (lockDurationMs) {
      await redis.set(
        lockoutKey(LOGIN_LOCK_PREFIX, email, ipAddress),
        '1',
        'EX',
        Math.ceil(lockDurationMs / 1000),
      );
    }
  } catch {
    // Non-critical: don't break the login error path if tracking fails
    logger.warn('[AUTH] Failed to record failed login attempt');
  }
}

async function clearFailedLogins(email: string, ipAddress?: string): Promise<void> {
  try {
    await getRedis().del(
      lockoutKey(LOGIN_FAIL_PREFIX, email, ipAddress),
      lockoutKey(LOGIN_LOCK_PREFIX, email, ipAddress),
    );
  } catch {
    // Non-critical: keys expire on their own
  }
}

interface SanitizedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AuthResult {
  user: SanitizedUser;
  accessToken: string;
  refreshToken: string;
}

interface RegisterResult {
  user: SanitizedUser;
  accessToken?: string;
  refreshToken?: string;
  requiresVerification: boolean;
}

function sanitizeUser(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SanitizedUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl ?? null,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export async function register(
  input: RegisterInput,
  deviceInfo?: string,
  ipAddress?: string,
): Promise<RegisterResult> {
  const existingUser = await authRepo.findUserByEmail(input.email);
  if (existingUser) {
    throw new ConflictError('Email already registered', 'EMAIL_ALREADY_EXISTS');
  }

  // Check if a soft-deleted account exists with this email — direct them to login to restore
  const deletedUser = await authRepo.findDeletedUserByEmail(input.email);
  if (deletedUser) {
    throw new ConflictError(
      'An account with this email was recently deleted. Log in to restore it.',
      'EMAIL_ALREADY_EXISTS',
    );
  }

  const hashedPassword = await hashPassword(input.password);
  const isActive = !env.REQUIRE_USER_VERIFICATION;

  const user = await authRepo.createUser({
    email: input.email,
    password: hashedPassword,
    firstName: input.firstName,
    lastName: input.lastName,
    isActive,
  });

  // If verification is required, don't issue tokens — user must verify first
  if (!isActive) {
    return {
      user: sanitizeUser(user),
      requiresVerification: true,
    };
  }

  const accessToken = signAccessToken({
    userId: user.id,
    role: user.role,
  });
  const refreshToken = generateRefreshToken();
  const refreshTokenExpiresAt = getRefreshTokenExpiresAt();

  const session = await sessionRepository.createSession({
    userId: user.id,
    deviceInfo,
    ipAddress,
    expiresAt: refreshTokenExpiresAt,
  });

  await authRepo.createRefreshToken({
    token: refreshToken,
    userId: user.id,
    sessionId: session.id,
    expiresAt: refreshTokenExpiresAt,
  });

  return {
    user: sanitizeUser(user),
    accessToken,
    refreshToken,
    requiresVerification: false,
  };
}

export async function login(
  input: LoginInput,
  deviceInfo?: string,
  ipAddress?: string,
): Promise<AuthResult> {
  let user = await authRepo.findUserByEmail(input.email);

  // If no active user found, check for a soft-deleted account that can be restored
  if (!user) {
    const deletedUser = await authRepo.findDeletedUserByEmail(input.email);
    if (!deletedUser) {
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    // Same email+IP lockout as the normal path — the restore flow must not be
    // a brute-force side door around the lockout.
    if (await isLoginLocked(input.email, ipAddress)) {
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    // Verify password before restoring — don't restore on wrong password
    const validPassword = await verifyPassword(input.password, deletedUser.password);
    if (!validPassword) {
      await recordFailedLogin(input.email, ipAddress);
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    // Successful restore-login — clear the email+IP failure counter, same as
    // the normal path.
    await clearFailedLogins(input.email, ipAddress);

    // Restore account: clears deletedAt, sets isActive = true, resets lockout
    await authRepo.restoreUser(deletedUser.id);
    user = { ...deletedUser, deletedAt: null, isActive: true, failedLoginAttempts: 0, lockedUntil: null };
  } else {
    // Normal login flow for active accounts

    // Distinct error for inactive accounts so the client can show proper messaging
    if (!user.isActive) {
      throw new ForbiddenError('Account is not activated. Please verify your account.', 'ACCOUNT_NOT_ACTIVE');
    }

    // Check account lockout — scoped to this email+IP pair (Redis), so an
    // attacker spamming bad passwords only locks out their OWN address and
    // cannot remotely lock the real user out (lockout DoS).
    if (await isLoginLocked(input.email, ipAddress)) {
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    // DB-level lock (legacy data or manual admin lock) is still honored.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    const valid = await verifyPassword(input.password, user.password);

    if (!valid) {
      await recordFailedLogin(input.email, ipAddress);
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    // Successful login — clear the email+IP failure counter and any stale
    // DB-level lockout state from before lockout moved to Redis.
    await clearFailedLogins(input.email, ipAddress);
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await authRepo.resetFailedAttempts(user.id);
    }
  }

  const accessToken = signAccessToken({
    userId: user.id,
    role: user.role,
  });
  const refreshToken = generateRefreshToken();
  const refreshTokenExpiresAt = getRefreshTokenExpiresAt();

  const session = await sessionRepository.createSession({
    userId: user.id,
    deviceInfo,
    ipAddress,
    expiresAt: refreshTokenExpiresAt,
  });

  await authRepo.createRefreshToken({
    token: refreshToken,
    userId: user.id,
    sessionId: session.id,
    expiresAt: refreshTokenExpiresAt,
  });

  return {
    user: sanitizeUser(user),
    accessToken,
    refreshToken,
  };
}

export async function refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const storedToken = await authRepo.findRefreshToken(refreshToken);
  if (!storedToken) {
    throw new UnauthorizedError('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
  }

  if (new Date() > storedToken.expiresAt) {
    await authRepo.deleteRefreshToken(refreshToken);
    throw new UnauthorizedError('Refresh token expired', 'REFRESH_TOKEN_EXPIRED');
  }

  const user = await authRepo.findUserById(storedToken.userId);
  if (!user) {
    throw new UnauthorizedError('User not found or disabled', 'INVALID_REFRESH_TOKEN');
  }
  if (!user.isActive) {
    throw new ForbiddenError('Account is not activated. Please verify your account.', 'ACCOUNT_NOT_ACTIVE');
  }

  const newAccessToken = signAccessToken({
    userId: user.id,
    role: user.role,
  });
  const newRefreshToken = generateRefreshToken();

  // Atomic rotation: delete old + create new in a single transaction.
  // Returns false if old token was already consumed by a concurrent request.
  const rotated = await authRepo.rotateRefreshToken(refreshToken, {
    token: newRefreshToken,
    userId: user.id,
    sessionId: storedToken.sessionId ?? undefined,
    expiresAt: getRefreshTokenExpiresAt(),
  });

  if (!rotated) {
    // REUSE DETECTED: the token existed when we looked it up but was consumed
    // by a concurrent request before we could rotate it — two parties presented
    // the same single-use token. We cannot tell which one is the attacker, and
    // whichever redeemed it first already holds a freshly rotated valid token.
    // Revoke the entire token family: every refresh token and session for this
    // user. Both legit client and attacker must re-authenticate.
    //
    // NOTE: this covers the *detectable* reuse path. Refresh tokens are opaque
    // random UUIDs (no JWT claims), so a token that is not found in the DB at
    // all (deleted in an earlier rotation) cannot be attributed to a user, and
    // the initial not-found lookup above can only reject it. Full replay
    // attribution would require tombstoning consumed tokens (e.g. a revokedAt
    // column) instead of deleting them — a schema change out of scope here.
    logger.warn(
      { userId: user.id },
      '[AUTH] Refresh token reuse detected — revoking all sessions and refresh tokens for user',
    );
    await authRepo.deleteRefreshTokensByUserId(user.id);
    await sessionRepository.deleteAllUserSessions(user.id);
    throw new UnauthorizedError('Refresh token already used', 'INVALID_REFRESH_TOKEN');
  }

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
}

export async function logout(refreshToken: string): Promise<void> {
  // Find the token before deleting so we can delete the linked session.
  // Both deleteRefreshToken and deleteSession handle "already deleted" (P2025)
  // gracefully, so no catch needed for concurrent request / cleanup job races.
  const storedToken = await authRepo.findRefreshToken(refreshToken);
  await authRepo.deleteRefreshToken(refreshToken);

  if (storedToken?.sessionId) {
    await sessionRepository.deleteSession(storedToken.sessionId);
  }
}

export async function getCurrentUser(userId: string): Promise<SanitizedUser> {
  const user = await authRepo.findUserById(userId);
  if (!user) {
    throw new NotFoundError('User not found', 'USER_NOT_FOUND');
  }

  return sanitizeUser(user);
}

interface SessionInfo {
  id: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  lastActiveAt: string;
  expiresAt: string;
  createdAt: string;
}

export async function getUserSessions(userId: string): Promise<SessionInfo[]> {
  const sessions = await sessionRepository.getUserSessions(userId);
  return sessions.map((session) => ({
    id: session.id,
    deviceInfo: session.deviceInfo,
    ipAddress: session.ipAddress,
    lastActiveAt: session.lastActiveAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
  }));
}

export async function logoutAllSessions(userId: string): Promise<number> {
  const sessionCount = await sessionRepository.deleteAllUserSessions(userId);
  await authRepo.deleteRefreshTokensByUserId(userId);
  return sessionCount;
}

export async function forgotPassword(email: string): Promise<void> {
  const user = await authRepo.findUserByEmail(email);

  // Silent return if user not found — prevents email enumeration
  if (!user) return;

  const redis = getRedis();

  // Invalidate any existing token for this user
  const existingToken = await redis.get(`${PASSWORD_RESET_USER_PREFIX}${user.id}`);
  if (existingToken) {
    await redis.del(`${PASSWORD_RESET_PREFIX}${existingToken}`);
    await redis.del(`${PASSWORD_RESET_USER_PREFIX}${user.id}`);
  }

  // Generate secure token and store in Redis with 1 hour TTL
  const token = crypto.randomBytes(32).toString('hex');

  await redis.set(`${PASSWORD_RESET_PREFIX}${token}`, user.id, 'EX', PASSWORD_RESET_TTL);
  await redis.set(`${PASSWORD_RESET_USER_PREFIX}${user.id}`, token, 'EX', PASSWORD_RESET_TTL);

  // Build reset URL and send email
  const resetUrl = `${env.CLIENT_URL}/reset-password?token=${token}`;
  const safeName = user.firstName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  try {
    await sendEmail({
      to: user.email,
      subject: 'Reset your password',
      html: `
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f3ee; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
          <tr>
            <td align="center">
              <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); border-left: 4px solid #c15f3c;">
                <tr>
                  <td style="padding: 40px;">
                    <p style="margin: 0 0 20px; font-size: 12px; font-weight: 600; color: #c15f3c; text-transform: uppercase; letter-spacing: 1.5px;">Password Reset</p>
                    <h1 style="margin: 0 0 8px; font-size: 22px; font-weight: 600; color: #1a170f;">Choose a new password</h1>
                    <p style="margin: 0 0 28px; font-size: 15px; color: #6b6560; line-height: 1.6;">
                      Hi ${safeName}, we received a request to reset your password. Click the button below to continue.
                    </p>
                    <a href="${resetUrl}" style="display: inline-block; background-color: #1a170f; color: #ffffff; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-size: 15px; font-weight: 600;">
                      Reset password &rarr;
                    </a>
                    <p style="margin: 28px 0 0; font-size: 13px; color: #9b958e; line-height: 1.6;">
                      This link expires in 1 hour. If you didn't request this, you can safely ignore this email.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 40px 32px;">
                    <div style="border-top: 1px solid #e8e6e1; padding-top: 20px;">
                      <p style="margin: 0; font-size: 12px; color: #b5b0a8; line-height: 1.5;">
                        If the button doesn't work, copy this link:<br/>
                        <a href="${resetUrl}" style="color: #c15f3c; text-decoration: underline; word-break: break-all;">${resetUrl}</a>
                      </p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `,
    });

    logger.info({ userId: user.id }, '[AUTH] Password reset email sent');
  } catch (error) {
    // Log but don't throw — prevents leaking email existence via 500 vs 200
    logger.error({ userId: user.id, err: error }, '[AUTH] Failed to send password reset email');
  }
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const redis = getRedis();

  const userId = await redis.get(`${PASSWORD_RESET_PREFIX}${token}`);
  if (!userId) {
    throw new BadRequestError('Invalid or expired reset token', 'INVALID_RESET_TOKEN');
  }

  const user = await authRepo.findUserById(userId);
  if (!user) {
    throw new NotFoundError('User not found', 'USER_NOT_FOUND');
  }

  const hashedPassword = await hashPassword(newPassword);
  await authRepo.updateUserPassword(userId, hashedPassword);

  // Clean up Redis tokens
  await redis.del(`${PASSWORD_RESET_PREFIX}${token}`);
  await redis.del(`${PASSWORD_RESET_USER_PREFIX}${userId}`);

  // Invalidate all sessions for security (force re-login with new password)
  await sessionRepository.deleteAllUserSessions(userId);
  await authRepo.deleteRefreshTokensByUserId(userId);

  logger.info({ userId }, '[AUTH] Password reset completed');
}
