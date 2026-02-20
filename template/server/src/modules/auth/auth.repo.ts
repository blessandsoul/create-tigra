import { prisma } from '@libs/prisma.js';

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email, deletedAt: null },
  });
}

export async function findUserById(id: string) {
  return prisma.user.findUnique({
    where: { id, deletedAt: null },
  });
}

export async function createUser(data: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}) {
  return prisma.user.create({
    data,
  });
}

export async function createRefreshToken(data: {
  token: string;
  userId: string;
  expiresAt: Date;
}) {
  return prisma.refreshToken.create({
    data,
  });
}

export async function findRefreshToken(token: string) {
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
    // P2025: Record not found — token was already deleted (e.g. concurrent request)
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code: string }).code === 'P2025'
    ) {
      return;
    }
    throw error;
  }
}

export async function rotateRefreshToken(
  oldToken: string,
  newData: { token: string; userId: string; expiresAt: Date },
): Promise<boolean> {
  try {
    await prisma.$transaction([
      prisma.refreshToken.delete({ where: { token: oldToken } }),
      prisma.refreshToken.create({ data: newData }),
    ]);
    return true;
  } catch (error) {
    // P2025: Old token not found — already consumed by a concurrent request
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code: string }).code === 'P2025'
    ) {
      return false;
    }
    throw error;
  }
}

export async function deleteRefreshTokensByUserId(userId: string) {
  return prisma.refreshToken.deleteMany({
    where: { userId },
  });
}

export async function incrementFailedAttempts(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginAttempts: { increment: 1 },
    },
  });
}

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
