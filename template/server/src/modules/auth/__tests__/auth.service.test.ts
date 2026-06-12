import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as authService from '../auth.service.js';
import * as authRepo from '../auth.repo.js';
import * as authLib from '@libs/auth.js';
import { hashPassword, verifyPassword } from '@libs/password.js';
import { ConflictError, UnauthorizedError, ForbiddenError, NotFoundError } from '@shared/errors/errors.js';
import { testUsers, testRefreshToken, testSession, resetMocks } from '@/test/setup.js';
import { sessionRepository } from '../session.repo.js';

// Mock dependencies
vi.mock('../auth.repo.js');
vi.mock('@libs/auth.js');
vi.mock('@libs/password.js');
vi.mock('../session.repo.js');

// In-memory Redis stub — account lockout (email+IP) uses Redis. Tests must
// never require a live Redis instance.
const mockRedis = vi.hoisted(() => ({
  exists: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@libs/redis.js', () => ({
  getRedis: (): typeof mockRedis => mockRedis,
}));

describe('Auth Service', () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
    // Default Redis behavior: nothing locked, first failure
    mockRedis.exists.mockResolvedValue(0);
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
  });

  describe('register', () => {
    const validRegisterInput = {
      email: 'newuser@example.com',
      password: 'Password123!',
      firstName: 'New',
      lastName: 'User',
    };

    it('should successfully register a new user', async () => {
      // Arrange — REQUIRE_USER_VERIFICATION=false in tests, so the user is
      // active immediately and tokens are issued.
      const hashedPassword = '$2a$12$hashedpassword';
      const createdUser = {
        ...testUsers.validUser,
        email: validRegisterInput.email,
        password: hashedPassword,
      };
      const accessToken = 'mock-access-token';
      const refreshToken = 'mock-refresh-token';
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(null);
      vi.mocked(authRepo.findDeletedUserByEmail).mockResolvedValue(null);
      vi.mocked(hashPassword).mockResolvedValue(hashedPassword);
      vi.mocked(authRepo.createUser).mockResolvedValue(createdUser);
      vi.mocked(authLib.signAccessToken).mockReturnValue(accessToken);
      vi.mocked(authLib.generateRefreshToken).mockReturnValue(refreshToken);
      vi.mocked(authLib.getRefreshTokenExpiresAt).mockReturnValue(expiresAt);
      vi.mocked(sessionRepository.createSession).mockResolvedValue(testSession);
      vi.mocked(authRepo.createRefreshToken).mockResolvedValue(testRefreshToken);

      // Act
      const result = await authService.register(validRegisterInput);

      // Assert
      expect(authRepo.findUserByEmail).toHaveBeenCalledWith(validRegisterInput.email);
      expect(hashPassword).toHaveBeenCalledWith(validRegisterInput.password);
      expect(authRepo.createUser).toHaveBeenCalledWith({
        email: validRegisterInput.email,
        password: hashedPassword,
        firstName: validRegisterInput.firstName,
        lastName: validRegisterInput.lastName,
        isActive: true,
      });
      expect(authLib.signAccessToken).toHaveBeenCalledWith({
        userId: createdUser.id,
        role: createdUser.role,
      });
      expect(authLib.generateRefreshToken).toHaveBeenCalled();
      expect(sessionRepository.createSession).toHaveBeenCalledWith({
        userId: createdUser.id,
        deviceInfo: undefined,
        ipAddress: undefined,
        expiresAt,
      });
      expect(authRepo.createRefreshToken).toHaveBeenCalledWith({
        token: refreshToken,
        userId: createdUser.id,
        sessionId: testSession.id,
        expiresAt,
      });
      expect(result).toEqual({
        user: expect.objectContaining({
          id: createdUser.id,
          email: createdUser.email,
          firstName: createdUser.firstName,
          lastName: createdUser.lastName,
          role: createdUser.role,
        }),
        accessToken,
        refreshToken,
        requiresVerification: false,
      });
      expect(result.user).not.toHaveProperty('password');
    });

    it('should throw ConflictError if email already exists', async () => {
      // Arrange
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(testUsers.validUser);

      // Act & Assert
      await expect(authService.register(validRegisterInput)).rejects.toThrow(ConflictError);
      await expect(authService.register(validRegisterInput)).rejects.toThrow('Email already registered');
      expect(hashPassword).not.toHaveBeenCalled();
      expect(authRepo.createUser).not.toHaveBeenCalled();
    });

    it('should throw ConflictError if a soft-deleted account exists with this email', async () => {
      // Arrange
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(null);
      vi.mocked(authRepo.findDeletedUserByEmail).mockResolvedValue({
        ...testUsers.validUser,
        deletedAt: new Date(),
      });

      // Act & Assert
      await expect(authService.register(validRegisterInput)).rejects.toThrow(ConflictError);
      expect(authRepo.createUser).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const validLoginInput = {
      email: 'test@example.com',
      password: 'Password123!',
    };

    it('should successfully login with valid credentials', async () => {
      // Arrange
      const accessToken = 'mock-access-token';
      const refreshToken = 'mock-refresh-token';
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(testUsers.validUser);
      vi.mocked(verifyPassword).mockResolvedValue(true);
      vi.mocked(authLib.signAccessToken).mockReturnValue(accessToken);
      vi.mocked(authLib.generateRefreshToken).mockReturnValue(refreshToken);
      vi.mocked(authLib.getRefreshTokenExpiresAt).mockReturnValue(expiresAt);
      vi.mocked(sessionRepository.createSession).mockResolvedValue(testSession);
      vi.mocked(authRepo.createRefreshToken).mockResolvedValue(testRefreshToken);

      // Act
      const result = await authService.login(validLoginInput);

      // Assert
      expect(authRepo.findUserByEmail).toHaveBeenCalledWith(validLoginInput.email);
      expect(verifyPassword).toHaveBeenCalledWith(validLoginInput.password, testUsers.validUser.password);
      expect(sessionRepository.createSession).toHaveBeenCalledWith({
        userId: testUsers.validUser.id,
        deviceInfo: undefined,
        ipAddress: undefined,
        expiresAt,
      });
      expect(authRepo.createRefreshToken).toHaveBeenCalledWith({
        token: refreshToken,
        userId: testUsers.validUser.id,
        sessionId: testSession.id,
        expiresAt,
      });
      expect(result).toEqual({
        user: expect.objectContaining({
          id: testUsers.validUser.id,
          email: testUsers.validUser.email,
        }),
        accessToken,
        refreshToken,
      });
      expect(result.user).not.toHaveProperty('password');
    });

    it('should throw UnauthorizedError if user not found', async () => {
      // Arrange
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(null);
      vi.mocked(authRepo.findDeletedUserByEmail).mockResolvedValue(null);

      // Act & Assert
      await expect(authService.login(validLoginInput)).rejects.toThrow(UnauthorizedError);
      await expect(authService.login(validLoginInput)).rejects.toThrow('Invalid email or password');
      expect(verifyPassword).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenError if account is not activated', async () => {
      // Arrange
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(testUsers.inactiveUser);

      // Act & Assert
      await expect(authService.login(validLoginInput)).rejects.toThrow(ForbiddenError);
      await expect(authService.login(validLoginInput)).rejects.toThrow(
        'Account is not activated. Please verify your account.',
      );
      expect(verifyPassword).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedError if password is invalid', async () => {
      // Arrange
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(testUsers.validUser);
      vi.mocked(verifyPassword).mockResolvedValue(false);

      // Act & Assert
      await expect(authService.login(validLoginInput)).rejects.toThrow(UnauthorizedError);
      await expect(authService.login(validLoginInput)).rejects.toThrow('Invalid email or password');
    });
  });

  describe('login — account lockout (email+IP scoped)', () => {
    const loginInput = { email: 'test@example.com', password: 'WrongPassword!' };
    const attackerIp = '203.0.113.7';

    it('should reject login when the email+IP pair is locked, without verifying the password', async () => {
      // Arrange
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(testUsers.validUser);
      mockRedis.exists.mockResolvedValue(1); // lock key present for this pair

      // Act & Assert
      await expect(
        authService.login(loginInput, 'test-agent', attackerIp),
      ).rejects.toThrow('Invalid email or password');
      expect(mockRedis.exists).toHaveBeenCalledWith(`login-lock:test@example.com:${attackerIp}`);
      expect(verifyPassword).not.toHaveBeenCalled();
    });

    it('should NOT lock out the same email from a different IP (no remote lockout DoS)', async () => {
      // Arrange — lock exists only for the attacker's IP; victim logs in from
      // their own IP and Redis reports no lock for that pair.
      const victimIp = '198.51.100.42';
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(testUsers.validUser);
      mockRedis.exists.mockResolvedValue(0);
      vi.mocked(verifyPassword).mockResolvedValue(true);
      vi.mocked(authLib.signAccessToken).mockReturnValue('access');
      vi.mocked(authLib.generateRefreshToken).mockReturnValue('refresh');
      vi.mocked(authLib.getRefreshTokenExpiresAt).mockReturnValue(expiresAt);
      vi.mocked(sessionRepository.createSession).mockResolvedValue(testSession);
      vi.mocked(authRepo.createRefreshToken).mockResolvedValue(testRefreshToken);

      // Act
      const result = await authService.login(
        { ...loginInput, password: 'Password123!' },
        'test-agent',
        victimIp,
      );

      // Assert — lock was checked for the VICTIM's pair only, and login succeeded
      expect(mockRedis.exists).toHaveBeenCalledWith(`login-lock:test@example.com:${victimIp}`);
      expect(result.accessToken).toBe('access');
    });

    it('should record a failed attempt against the email+IP pair on bad password', async () => {
      // Arrange
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(testUsers.validUser);
      vi.mocked(verifyPassword).mockResolvedValue(false);
      mockRedis.incr.mockResolvedValue(3); // below the first lockout threshold

      // Act & Assert
      await expect(authService.login(loginInput, 'test-agent', attackerIp)).rejects.toThrow(
        UnauthorizedError,
      );
      expect(mockRedis.incr).toHaveBeenCalledWith(`login-fail:test@example.com:${attackerIp}`);
      expect(mockRedis.set).not.toHaveBeenCalled(); // no lock yet
    });

    it('should set a lock for the email+IP pair after 5 failures (15 min)', async () => {
      // Arrange
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(testUsers.validUser);
      vi.mocked(verifyPassword).mockResolvedValue(false);
      mockRedis.incr.mockResolvedValue(5); // hits the first threshold

      // Act & Assert
      await expect(authService.login(loginInput, 'test-agent', attackerIp)).rejects.toThrow(
        UnauthorizedError,
      );
      expect(mockRedis.set).toHaveBeenCalledWith(
        `login-lock:test@example.com:${attackerIp}`,
        '1',
        'EX',
        15 * 60,
      );
    });

    it('should fail open and allow login when Redis is unavailable', async () => {
      // Arrange — Redis down: lockout checks must not block all logins
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(testUsers.validUser);
      mockRedis.exists.mockRejectedValue(new Error('Redis down'));
      mockRedis.del.mockRejectedValue(new Error('Redis down'));
      vi.mocked(verifyPassword).mockResolvedValue(true);
      vi.mocked(authLib.signAccessToken).mockReturnValue('access');
      vi.mocked(authLib.generateRefreshToken).mockReturnValue('refresh');
      vi.mocked(authLib.getRefreshTokenExpiresAt).mockReturnValue(expiresAt);
      vi.mocked(sessionRepository.createSession).mockResolvedValue(testSession);
      vi.mocked(authRepo.createRefreshToken).mockResolvedValue(testRefreshToken);

      // Act
      const result = await authService.login(
        { ...loginInput, password: 'Password123!' },
        'test-agent',
        attackerIp,
      );

      // Assert
      expect(result.accessToken).toBe('access');
    });
  });

  describe('login — soft-deleted account restore path (lockout)', () => {
    const loginInput = { email: 'test@example.com', password: 'WrongPassword!' };
    const attackerIp = '203.0.113.7';
    const softDeletedUser = {
      ...testUsers.validUser,
      deletedAt: new Date('2024-02-01T00:00:00Z'),
      isActive: false,
    };

    it('should record a failed attempt against the email+IP pair on wrong password for a soft-deleted account', async () => {
      // Arrange
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(null);
      vi.mocked(authRepo.findDeletedUserByEmail).mockResolvedValue(softDeletedUser);
      vi.mocked(verifyPassword).mockResolvedValue(false);
      mockRedis.incr.mockResolvedValue(3); // below the first lockout threshold

      // Act & Assert
      await expect(authService.login(loginInput, 'test-agent', attackerIp)).rejects.toThrow(
        'Invalid email or password',
      );
      expect(mockRedis.incr).toHaveBeenCalledWith(`login-fail:test@example.com:${attackerIp}`);
      expect(authRepo.restoreUser).not.toHaveBeenCalled();
    });

    it('should reject a locked email+IP pair on the soft-delete path before verifying the password', async () => {
      // Arrange
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(null);
      vi.mocked(authRepo.findDeletedUserByEmail).mockResolvedValue(softDeletedUser);
      mockRedis.exists.mockResolvedValue(1); // lock key present for this pair

      // Act & Assert
      await expect(authService.login(loginInput, 'test-agent', attackerIp)).rejects.toThrow(
        'Invalid email or password',
      );
      expect(mockRedis.exists).toHaveBeenCalledWith(`login-lock:test@example.com:${attackerIp}`);
      expect(verifyPassword).not.toHaveBeenCalled();
      expect(authRepo.restoreUser).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const validRefreshToken = 'valid-refresh-token';

    it('should successfully refresh tokens with valid refresh token', async () => {
      // Arrange
      const newAccessToken = 'new-access-token';
      const newRefreshToken = 'new-refresh-token';
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const storedToken = {
        ...testRefreshToken,
        token: validRefreshToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // expires in 1 day
      };

      vi.mocked(authRepo.findRefreshToken).mockResolvedValue(storedToken);
      vi.mocked(authRepo.findUserById).mockResolvedValue(testUsers.validUser);
      vi.mocked(authLib.signAccessToken).mockReturnValue(newAccessToken);
      vi.mocked(authLib.generateRefreshToken).mockReturnValue(newRefreshToken);
      vi.mocked(authLib.getRefreshTokenExpiresAt).mockReturnValue(expiresAt);
      vi.mocked(authRepo.rotateRefreshToken).mockResolvedValue(true);

      // Act
      const result = await authService.refresh(validRefreshToken);

      // Assert
      expect(authRepo.findRefreshToken).toHaveBeenCalledWith(validRefreshToken);
      expect(authRepo.findUserById).toHaveBeenCalledWith(storedToken.userId);
      expect(authLib.signAccessToken).toHaveBeenCalledWith({
        userId: testUsers.validUser.id,
        role: testUsers.validUser.role,
      });
      expect(authRepo.rotateRefreshToken).toHaveBeenCalledWith(validRefreshToken, {
        token: newRefreshToken,
        userId: testUsers.validUser.id,
        sessionId: undefined, // fixture sessionId is null → normalized to undefined
        expiresAt,
      });
      expect(result).toEqual({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      });
    });

    it('should throw UnauthorizedError if refresh token not found', async () => {
      // Arrange
      vi.mocked(authRepo.findRefreshToken).mockResolvedValue(null);

      // Act & Assert
      await expect(authService.refresh(validRefreshToken)).rejects.toThrow(UnauthorizedError);
      await expect(authService.refresh(validRefreshToken)).rejects.toThrow('Invalid refresh token');
    });

    it('should throw UnauthorizedError if refresh token expired', async () => {
      // Arrange
      const expiredToken = {
        ...testRefreshToken,
        expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
      };
      vi.mocked(authRepo.findRefreshToken).mockResolvedValue(expiredToken);
      vi.mocked(authRepo.deleteRefreshToken).mockResolvedValue(undefined);

      // Act & Assert
      await expect(authService.refresh(validRefreshToken)).rejects.toThrow(UnauthorizedError);
      await expect(authService.refresh(validRefreshToken)).rejects.toThrow('Refresh token expired');
      expect(authRepo.deleteRefreshToken).toHaveBeenCalledWith(validRefreshToken);
    });

    it('should throw UnauthorizedError if user not found', async () => {
      // Arrange
      const storedToken = {
        ...testRefreshToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
      vi.mocked(authRepo.findRefreshToken).mockResolvedValue(storedToken);
      vi.mocked(authRepo.findUserById).mockResolvedValue(null);

      // Act & Assert
      await expect(authService.refresh(validRefreshToken)).rejects.toThrow(UnauthorizedError);
      await expect(authService.refresh(validRefreshToken)).rejects.toThrow('User not found or disabled');
    });

    it('should throw ForbiddenError if user is not activated', async () => {
      // Arrange
      const storedToken = {
        ...testRefreshToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
      vi.mocked(authRepo.findRefreshToken).mockResolvedValue(storedToken);
      vi.mocked(authRepo.findUserById).mockResolvedValue(testUsers.inactiveUser);

      // Act & Assert
      await expect(authService.refresh(validRefreshToken)).rejects.toThrow(ForbiddenError);
      await expect(authService.refresh(validRefreshToken)).rejects.toThrow(
        'Account is not activated. Please verify your account.',
      );
    });

    it('should revoke ALL refresh tokens and sessions when token reuse is detected', async () => {
      // Regression test for refresh-token-reuse family revocation:
      // the token was found, but the atomic rotation reports it was already
      // consumed by a concurrent request — two parties presented the same
      // single-use token. The whole family must be revoked, because whichever
      // party redeemed it first (possibly an attacker) holds a valid token.
      const storedToken = {
        ...testRefreshToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
      vi.mocked(authRepo.findRefreshToken).mockResolvedValue(storedToken);
      vi.mocked(authRepo.findUserById).mockResolvedValue(testUsers.validUser);
      vi.mocked(authLib.signAccessToken).mockReturnValue('access');
      vi.mocked(authLib.generateRefreshToken).mockReturnValue('refresh');
      vi.mocked(authLib.getRefreshTokenExpiresAt).mockReturnValue(new Date());
      vi.mocked(authRepo.rotateRefreshToken).mockResolvedValue(false); // already consumed
      vi.mocked(authRepo.deleteRefreshTokensByUserId).mockResolvedValue(undefined);
      vi.mocked(sessionRepository.deleteAllUserSessions).mockResolvedValue(1);

      // Act & Assert
      await expect(authService.refresh(validRefreshToken)).rejects.toThrow(UnauthorizedError);
      expect(authRepo.deleteRefreshTokensByUserId).toHaveBeenCalledWith(testUsers.validUser.id);
      expect(sessionRepository.deleteAllUserSessions).toHaveBeenCalledWith(testUsers.validUser.id);
    });

    it('should NOT revoke the token family on a successful rotation', async () => {
      // Companion to the reuse test — the revocation path must not fire on
      // the happy path.
      const storedToken = {
        ...testRefreshToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
      vi.mocked(authRepo.findRefreshToken).mockResolvedValue(storedToken);
      vi.mocked(authRepo.findUserById).mockResolvedValue(testUsers.validUser);
      vi.mocked(authLib.signAccessToken).mockReturnValue('access');
      vi.mocked(authLib.generateRefreshToken).mockReturnValue('refresh');
      vi.mocked(authLib.getRefreshTokenExpiresAt).mockReturnValue(new Date());
      vi.mocked(authRepo.rotateRefreshToken).mockResolvedValue(true);

      // Act
      await authService.refresh(validRefreshToken);

      // Assert
      expect(authRepo.deleteRefreshTokensByUserId).not.toHaveBeenCalled();
      expect(sessionRepository.deleteAllUserSessions).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('should delete refresh token and its linked session', async () => {
      // Arrange
      const refreshToken = 'valid-refresh-token';
      const storedToken = {
        ...testRefreshToken,
        token: refreshToken,
        sessionId: 'session-1',
      };

      vi.mocked(authRepo.findRefreshToken).mockResolvedValue(storedToken);
      vi.mocked(authRepo.deleteRefreshToken).mockResolvedValue(undefined);
      vi.mocked(sessionRepository.deleteSession).mockResolvedValue(undefined as never);

      // Act
      await authService.logout(refreshToken);

      // Assert
      expect(authRepo.findRefreshToken).toHaveBeenCalledWith(refreshToken);
      expect(authRepo.deleteRefreshToken).toHaveBeenCalledWith(refreshToken);
      expect(sessionRepository.deleteSession).toHaveBeenCalledWith('session-1');
    });

    it('should not delete a session when the token has no sessionId', async () => {
      // Arrange — testRefreshToken fixture has sessionId: null
      const refreshToken = 'valid-refresh-token';
      vi.mocked(authRepo.findRefreshToken).mockResolvedValue({
        ...testRefreshToken,
        token: refreshToken,
      });
      vi.mocked(authRepo.deleteRefreshToken).mockResolvedValue(undefined);

      // Act
      await authService.logout(refreshToken);

      // Assert
      expect(authRepo.deleteRefreshToken).toHaveBeenCalledWith(refreshToken);
      expect(sessionRepository.deleteSession).not.toHaveBeenCalled();
    });

    it('should propagate unexpected repository errors', async () => {
      // "Token already deleted" is handled gracefully inside the repo (P2025);
      // anything else is a real failure and must reach the global error handler.
      const refreshToken = 'valid-refresh-token';
      vi.mocked(authRepo.findRefreshToken).mockRejectedValue(new Error('DB error'));

      // Act & Assert
      await expect(authService.logout(refreshToken)).rejects.toThrow('DB error');
    });
  });

  describe('getCurrentUser', () => {
    it('should return sanitized user data', async () => {
      // Arrange
      vi.mocked(authRepo.findUserById).mockResolvedValue(testUsers.validUser);

      // Act
      const result = await authService.getCurrentUser(testUsers.validUser.id);

      // Assert
      expect(authRepo.findUserById).toHaveBeenCalledWith(testUsers.validUser.id);
      expect(result).toEqual(
        expect.objectContaining({
          id: testUsers.validUser.id,
          email: testUsers.validUser.email,
          firstName: testUsers.validUser.firstName,
          lastName: testUsers.validUser.lastName,
          role: testUsers.validUser.role,
        }),
      );
      expect(result).not.toHaveProperty('password');
    });

    it('should throw NotFoundError if user not found', async () => {
      // Arrange
      vi.mocked(authRepo.findUserById).mockResolvedValue(null);

      // Act & Assert
      await expect(authService.getCurrentUser('invalid-user-id')).rejects.toThrow(NotFoundError);
      await expect(authService.getCurrentUser('invalid-user-id')).rejects.toThrow('User not found');
    });
  });
});
