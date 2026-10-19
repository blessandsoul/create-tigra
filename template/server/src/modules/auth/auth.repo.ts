import { prisma, isPrismaNotFound, isPrismaWriteConflict } from '@libs/prisma.js';
import { hashToken } from '@libs/token-hash.js';
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

// Refresh tokens: callers pass the RAW token (from the cookie); the table only
// ever holds its fingerprint (libs/token-hash.ts), so reading the table gives
// nobody a usable login. Every function below hashes before touching it.

export async function createRefreshToken(data: {
  token: string;
  userId: string;
  sessionId?: string;
  expiresAt: Date;
}): Promise<RefreshToken> {
  return prisma.refreshToken.create({
    data: { ...data, token: hashToken(data.token) },
  });
}

export async function findRefreshToken(token: string): Promise<RefreshToken | null> {
  return prisma.refreshToken.findUnique({
    where: { token: hashToken(token) },
  });
}

export async function deleteRefreshToken(token: string): Promise<void> {
  try {
    await prisma.refreshToken.delete({
      where: { token: hashToken(token) },
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
 * Exactly one of several parallel rotations of the same token wins. The old
 * row is removed with deleteMany, a locking DELETE whose count says whether
 * THIS transaction removed it: a parallel one waits for the row lock, then
 * removes nothing and returns false. (delete() checked the row in a snapshot
 * first, so under MySQL's REPEATABLE READ two parallel refreshes both "found"
 * it and both created a new token, forking the login; sometimes they
 * deadlocked instead and answered 500.)
 *
 * Returns false when this request did not win: the token was already rotated
 * by a parallel refresh, the session is gone, or MySQL reported a write
 * conflict with the parallel transaction. See refresh() in auth.service.ts.
 * Both tokens are passed raw and stored as fingerprints.
 */
export async function rotateRefreshToken(
  oldToken: string,
  newData: { token: string; userId: string; sessionId: string; expiresAt: Date },
): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      const { count } = await tx.refreshToken.deleteMany({ where: { token: hashToken(oldToken) } });
      if (count !== 1) return false; // a parallel refresh rotated it first
      await tx.session.update({
        where: { id: newData.sessionId },
        data: { expiresAt: newData.expiresAt, lastActiveAt: new Date() },
      });
      await tx.refreshToken.create({ data: { ...newData, token: hashToken(newData.token) } });
      return true;
    });
  } catch (error) {
    if (isPrismaNotFound(error) || isPrismaWriteConflict(error)) return false;
    throw error;
  }
}

/**
 * Delete a user's refresh tokens; with `exceptSessionId`, keep that one
 * session's tokens (an owner's password change keeps the asking device signed
 * in). Tokens without a session are always deleted: the explicit `sessionId:
 * null` branch is needed because SQL `sessionId <> x` skips NULL rows.
 */
export async function deleteRefreshTokensByUserId(
  userId: string,
  options: { exceptSessionId?: string } = {},
): Promise<void> {
  const { exceptSessionId } = options;
  await prisma.refreshToken.deleteMany({
    where: exceptSessionId
      ? { userId, OR: [{ sessionId: null }, { sessionId: { not: exceptSessionId } }] }
      : { userId },
  });
}

export async function updateUserPassword(userId: string, hashedPassword: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword },
  });
}
