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

    // Verify password before restoring — don't restore on wrong password
    const validPassword = await verifyPassword(input.password, deletedUser.password);
    if (!validPassword) {
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    // Restore account: clears deletedAt, sets isActive = true, resets lockout
    await authRepo.restoreUser(deletedUser.id);
    user = { ...deletedUser, deletedAt: null, isActive: true, failedLoginAttempts: 0, lockedUntil: null };
  } else {
    // Normal login flow for active accounts

    // Distinct error for inactive accounts so the client can show proper messaging
    if (!user.isActive) {
      throw new ForbiddenError('Account is not activated. Please verify your account.', 'ACCOUNT_NOT_ACTIVE');
    }

    // Check account lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    const valid = await verifyPassword(input.password, user.password);

    if (!valid) {
      // Increment failed attempts
      const newAttempts = user.failedLoginAttempts + 1;
      await authRepo.incrementFailedAttempts(user.id);

      // Check if we need to lock the account
      const lockDuration = getLockoutDuration(newAttempts);
      if (lockDuration) {
        await authRepo.setAccountLock(user.id, new Date(Date.now() + lockDuration));
      }

      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    // Successful login — reset failed attempts
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
