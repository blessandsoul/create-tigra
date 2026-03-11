import { vi } from 'vitest';

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'mysql://test:test@localhost:3306/test_db';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_SECRET = 'test-jwt-secret-must-be-at-least-32-characters-long';
process.env.JWT_ACCESS_EXPIRY = '15m';
process.env.JWT_REFRESH_EXPIRY = '7d';
process.env.PORT = '3000';
process.env.HOST = '0.0.0.0';

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

// Test refresh token data
export const testRefreshToken = {
  id: 'test-token-id-1',
  token: 'test-refresh-token-uuid',
  userId: testUsers.validUser.id,
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
  createdAt: new Date(),
};

// Reset all mocks before each test
export const resetMocks = (): void => {
  vi.clearAllMocks();
};
