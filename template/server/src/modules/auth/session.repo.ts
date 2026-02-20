import { prisma } from '@libs/prisma.js';
import type { Session } from '@prisma/client';

export class SessionRepository {
  /**
   * Create a new session
   */
  async createSession(data: {
    userId: string;
    deviceInfo?: string;
    ipAddress?: string;
    expiresAt: Date;
  }): Promise<Session> {
    return prisma.session.create({
      data: {
        userId: data.userId,
        deviceInfo: data.deviceInfo,
        ipAddress: data.ipAddress,
        expiresAt: data.expiresAt,
      },
    });
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(userId: string): Promise<Session[]> {
    return prisma.session.findMany({
      where: {
        userId,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        lastActiveAt: 'desc',
      },
    });
  }

  /**
   * Update session last active timestamp
   */
  async updateLastActive(sessionId: string): Promise<Session> {
    return prisma.session.update({
      where: { id: sessionId },
      data: {
        lastActiveAt: new Date(),
      },
    });
  }

  /**
   * Delete a specific session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await prisma.session.delete({
      where: { id: sessionId },
    });
  }

  /**
   * Delete all sessions for a user
   */
  async deleteAllUserSessions(userId: string): Promise<number> {
    const result = await prisma.session.deleteMany({
      where: { userId },
    });
    return result.count;
  }

  /**
   * Delete expired sessions (for cleanup cron job)
   */
  async deleteExpiredSessions(): Promise<number> {
    const result = await prisma.session.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    return result.count;
  }

  /**
   * Get session by ID
   */
  async getSessionById(sessionId: string): Promise<Session | null> {
    return prisma.session.findUnique({
      where: { id: sessionId },
    });
  }

  /**
   * Count active sessions for a user
   */
  async countUserSessions(userId: string): Promise<number> {
    return prisma.session.count({
      where: {
        userId,
        expiresAt: {
          gt: new Date(),
        },
      },
    });
  }
}

export const sessionRepository = new SessionRepository();
