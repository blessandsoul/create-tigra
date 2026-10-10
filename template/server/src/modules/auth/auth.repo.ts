import { prisma, isPrismaNotFound } from '@libs/prisma.js';
import type { User, RefreshToken } from '@prisma/client';

export async function findUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({
    where: { email, deletedAt: null },
  });
}

export async function findDeletedUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findFirst({
    where: { email, deletedAt: { not: null } },
  });
}

export async function findUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({
    where: { id, deletedAt: null },
  });
}

export async function createUser(data: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  /** null = must verify email first; a Date = already verified. */
  emailVerifiedAt?: Date | null;
}): Promise<User> {
  return prisma.user.create({
    data,
  });
}

export async function createRefreshToken(data: {
  token: string;
  userId: string;
  sessionId?: string;
  expiresAt: Date;
}): Promise<RefreshToken> {
  return prisma.refreshToken.create({
    data,
  });
}

export async function findRefreshToken(token: string): Promise<RefreshToken | null> {
  return prisma.refreshToken.findUnique({
    where: { token },
  });
}

export async function deleteRefreshToken(token: string): Promise<void> {
  try {
    await prisma.refreshToken.delete({
      where: { token },
    });
  } catch (error) {
    if (isPrismaNotFound(error)) return;
    throw error;
  }
}

/**
 * Atomically swap a refresh token for a new one AND move its session forward.
 *
 * The session row is what users (GET /auth/sessions) and admins see and
 * revoke, so it must stay in step with the token family: every rotation sets
 * the session's expiresAt to the new token's expiry and refreshes lastActiveAt.
 * Previously only the token's expiry slid forward, so after the first
 * JWT_REFRESH_EXPIRY window a still-used login vanished from session lists and
 * could no longer be force-expired.
 *
 * Returns false when the old token (or the session) is already gone — a
 * concurrent redemption, which the caller treats as reuse.
 */
export async function rotateRefreshToken(
  oldToken: string,
  newData: { token: string; userId: string; sessionId: string; expiresAt: Date },
): Promise<boolean> {
  try {
    await prisma.$transaction([
      prisma.refreshToken.delete({ where: { token: oldToken } }),
      prisma.session.update({
        where: { id: newData.sessionId },
        data: { expiresAt: newData.expiresAt, lastActiveAt: new Date() },
      }),
      prisma.refreshToken.create({ data: newData }),
    ]);
    return true;
  } catch (error) {
    if (isPrismaNotFound(error)) return false;
    throw error;
  }
}

export async function deleteRefreshTokensByUserId(userId: string): Promise<void> {
  await prisma.refreshToken.deleteMany({
    where: { userId },
  });
}

/** @deprecated Lockout moved to Redis email+IP keys in auth.service.ts; kept for back-compat, slated for removal. */
export async function incrementFailedAttempts(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginAttempts: { increment: 1 },
    },
  });
}

/** @deprecated Lockout moved to Redis email+IP keys in auth.service.ts; kept for back-compat, slated for removal. */
export async function setAccountLock(userId: string, lockedUntil: Date): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { lockedUntil },
  });
}

export async function resetFailedAttempts(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
}

export async function updateUserPassword(userId: string, hashedPassword: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword },
  });
}
