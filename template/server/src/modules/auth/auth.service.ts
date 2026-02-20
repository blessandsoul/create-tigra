import { signAccessToken, generateRefreshToken, getRefreshTokenExpiresAt } from '@libs/auth.js';
import { hashPassword, verifyPassword } from '@libs/password.js';
import {
  ConflictError,
  UnauthorizedError,
  NotFoundError,
} from '@shared/errors/errors.js';
import type { UserRole } from '@shared/types/index.js';
import * as authRepo from './auth.repo.js';
import { sessionRepository } from './session.repo.js';
import type { RegisterInput, LoginInput } from './auth.schemas.js';

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
  password: string;
}): SanitizedUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password: _password, createdAt, updatedAt, avatarUrl, ...rest } = user;
  return {
    ...rest,
    avatarUrl: avatarUrl ?? null,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

export async function register(
  input: RegisterInput,
  deviceInfo?: string,
  ipAddress?: string,
): Promise<AuthResult> {
  const existingUser = await authRepo.findUserByEmail(input.email);
  if (existingUser) {
    throw new ConflictError('Email already registered', 'EMAIL_ALREADY_EXISTS');
  }

  const hashedPassword = await hashPassword(input.password);

  const user = await authRepo.createUser({
    email: input.email,
    password: hashedPassword,
    firstName: input.firstName,
    lastName: input.lastName,
  });

  const accessToken = signAccessToken({
    userId: user.id,
    role: user.role,
  });
  const refreshToken = generateRefreshToken();
  const refreshTokenExpiresAt = getRefreshTokenExpiresAt();

  await authRepo.createRefreshToken({
    token: refreshToken,
    userId: user.id,
    expiresAt: refreshTokenExpiresAt,
  });

  await sessionRepository.createSession({
    userId: user.id,
    deviceInfo,
    ipAddress,
    expiresAt: refreshTokenExpiresAt,
  });

  return {
    user: sanitizeUser(user),
    accessToken,
    refreshToken,
  };
}

export async function login(
  input: LoginInput,
  deviceInfo?: string,
  ipAddress?: string,
): Promise<AuthResult> {
  const user = await authRepo.findUserByEmail(input.email);
  if (!user) {
    throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  // Generic error for disabled accounts — prevent info leakage
  if (!user.isActive) {
    throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  // Check account lockout
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const { valid, needsRehash } = await verifyPassword(input.password, user.password);

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

  // Transparent rehash: upgrade bcrypt → argon2id
  if (needsRehash) {
    const newHash = await hashPassword(input.password);
    await authRepo.updateUserPassword(user.id, newHash);
  }

  const accessToken = signAccessToken({
    userId: user.id,
    role: user.role,
  });
  const refreshToken = generateRefreshToken();
  const refreshTokenExpiresAt = getRefreshTokenExpiresAt();

  await authRepo.createRefreshToken({
    token: refreshToken,
    userId: user.id,
    expiresAt: refreshTokenExpiresAt,
  });

  await sessionRepository.createSession({
    userId: user.id,
    deviceInfo,
    ipAddress,
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
  if (!user || !user.isActive) {
    throw new UnauthorizedError('User not found or disabled', 'INVALID_REFRESH_TOKEN');
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
  try {
    // Find the token before deleting so we can match the corresponding session
    const storedToken = await authRepo.findRefreshToken(refreshToken);
    await authRepo.deleteRefreshToken(refreshToken);

    if (storedToken) {
      // Match session by creation time — token and session are created together during login
      const sessions = await sessionRepository.getUserSessions(storedToken.userId);
      const tokenCreatedMs = storedToken.createdAt.getTime();
      const matchingSession = sessions.find(
        (s) => Math.abs(s.createdAt.getTime() - tokenCreatedMs) < 5000,
      );

      if (matchingSession) {
        await sessionRepository.deleteSession(matchingSession.id);
      }
    }
  } catch {
    // Token may already be deleted by concurrent request or cleanup job
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
