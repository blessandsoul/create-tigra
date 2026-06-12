import { vi } from 'vitest';

// Mock environment variables for testing.
// This setup file runs BEFORE any test file is imported (vitest setupFiles),
// so these must form a COMPLETE valid env: src/config/env.ts validates on
// import and calls process.exit(1) on failure, killing the whole suite before
// a single test runs.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'mysql://test:test@localhost:3306/test_db';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_SECRET = 'test-jwt-secret-must-be-at-least-32-characters-long';
process.env.JWT_ACCESS_EXPIRY = '15m';
process.env.JWT_REFRESH_EXPIRY = '7d';
process.env.PORT = '3000';
process.env.HOST = '0.0.0.0';
// REQUIRE_USER_VERIFICATION defaults to 'true', and env.ts exits when it is
// enabled without RESEND_API_KEY. Tests don't send email — disable it.
process.env.REQUIRE_USER_VERIFICATION = 'false';

// Test user data
export const testUsers = {
  validUser: {
    id: 'test-user-id-1',
    email: 'test@example.com',
    password: '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYiIJU6u1Em', // hashed "Password123!"
    firstName: 'Test',
    lastName: 'User',
    avatarUrl: null,
    role: 'USER' as const,
    isActive: true,
    deletedAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  },
  inactiveUser: {
    id: 'test-user-id-2',
    email: 'inactive@example.com',
    password: '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYiIJU6u1Em',
    firstName: 'Inactive',
    lastName: 'User',
    avatarUrl: null,
    role: 'USER' as const,
    isActive: false,
    deletedAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  },
  adminUser: {
    id: 'test-user-id-3',
    email: 'admin@example.com',
    password: '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYiIJU6u1Em',
    firstName: 'Admin',
    lastName: 'User',
    avatarUrl: null,
    role: 'ADMIN' as const,
    isActive: true,
    deletedAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  },
};

// Test refresh token data — fields must match the Prisma RefreshToken model
// exactly (id, token, userId, sessionId, expiresAt, createdAt)
export const testRefreshToken = {
  id: 'test-token-id-1',
  token: 'test-refresh-token-uuid',
  userId: testUsers.validUser.id,
  sessionId: null,
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
  createdAt: new Date(),
};

// Test session data — fields must match the Prisma Session model exactly
export const testSession = {
  id: 'test-session-id-1',
  userId: testUsers.validUser.id,
  deviceInfo: null,
  ipAddress: null,
  lastActiveAt: new Date('2024-01-01T00:00:00Z'),
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  createdAt: new Date('2024-01-01T00:00:00Z'),
};

// Reset all mocks before each test
export const resetMocks = (): void => {
  vi.clearAllMocks();
};
