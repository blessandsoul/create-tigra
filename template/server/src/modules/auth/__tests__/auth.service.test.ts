import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as authService from '../auth.service.js';
import * as authRepo from '../auth.repo.js';
import * as authLib from '@libs/auth.js';
import { hashPassword, verifyPassword } from '@libs/password.js';
import { ConflictError, UnauthorizedError, NotFoundError } from '@shared/errors/errors.js';
import { testUsers, testRefreshToken, resetMocks } from '@/test/setup.js';
import { sessionRepository } from '../session.repo.js';

// Mock dependencies
vi.mock('../auth.repo.js');
vi.mock('@libs/auth.js');
vi.mock('@libs/password.js');
vi.mock('../session.repo.js');

describe('Auth Service', () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe('register', () => {
    const validRegisterInput = {
      email: 'newuser@example.com',
      password: 'Password123!',
      firstName: 'New',
      lastName: 'User',
    };

    it('should successfully register a new user', async () => {
      // Arrange
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
      vi.mocked(hashPassword).mockResolvedValue(hashedPassword);
      vi.mocked(authRepo.createUser).mockResolvedValue(createdUser);
      vi.mocked(authLib.signAccessToken).mockReturnValue(accessToken);
      vi.mocked(authLib.generateRefreshToken).mockReturnValue(refreshToken);
      vi.mocked(authLib.getRefreshTokenExpiresAt).mockReturnValue(expiresAt);
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
      });
      expect(authLib.signAccessToken).toHaveBeenCalledWith({
        userId: createdUser.id,
        role: createdUser.role,
      });
      expect(authLib.generateRefreshToken).toHaveBeenCalled();
      expect(authRepo.createRefreshToken).toHaveBeenCalledWith({
        token: refreshToken,
        userId: createdUser.id,
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
      vi.mocked(verifyPassword).mockResolvedValue({ valid: true, needsRehash: false });
      vi.mocked(authLib.signAccessToken).mockReturnValue(accessToken);
      vi.mocked(authLib.generateRefreshToken).mockReturnValue(refreshToken);
      vi.mocked(authLib.getRefreshTokenExpiresAt).mockReturnValue(expiresAt);
      vi.mocked(authRepo.createRefreshToken).mockResolvedValue(testRefreshToken);

      // Act
      const result = await authService.login(validLoginInput);

      // Assert
      expect(authRepo.findUserByEmail).toHaveBeenCalledWith(validLoginInput.email);
      expect(verifyPassword).toHaveBeenCalledWith(validLoginInput.password, testUsers.validUser.password);
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

      // Act & Assert
      await expect(authService.login(validLoginInput)).rejects.toThrow(UnauthorizedError);
      await expect(authService.login(validLoginInput)).rejects.toThrow('Invalid email or password');
      expect(verifyPassword).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedError if account is disabled', async () => {
      // Arrange
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(testUsers.inactiveUser);

      // Act & Assert
      await expect(authService.login(validLoginInput)).rejects.toThrow(UnauthorizedError);
      await expect(authService.login(validLoginInput)).rejects.toThrow('Invalid email or password');
      expect(verifyPassword).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedError if password is invalid', async () => {
      // Arrange
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(testUsers.validUser);
      vi.mocked(verifyPassword).mockResolvedValue({ valid: false, needsRehash: false });

      // Act & Assert
      await expect(authService.login(validLoginInput)).rejects.toThrow(UnauthorizedError);
      await expect(authService.login(validLoginInput)).rejects.toThrow('Invalid email or password');
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

    it('should throw UnauthorizedError if user is disabled', async () => {
      // Arrange
      const storedToken = {
        ...testRefreshToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
      vi.mocked(authRepo.findRefreshToken).mockResolvedValue(storedToken);
      vi.mocked(authRepo.findUserById).mockResolvedValue(testUsers.inactiveUser);

      // Act & Assert
      await expect(authService.refresh(validRefreshToken)).rejects.toThrow(UnauthorizedError);
      await expect(authService.refresh(validRefreshToken)).rejects.toThrow('User not found or disabled');
    });
  });

  describe('logout', () => {
    it('should delete refresh token and matching session', async () => {
      // Arrange
      const refreshToken = 'valid-refresh-token';
      const tokenCreatedAt = new Date('2024-06-01T12:00:00Z');
      const storedToken = {
        ...testRefreshToken,
        token: refreshToken,
        createdAt: tokenCreatedAt,
      };
      const matchingSession = {
        id: 'session-1',
        userId: testUsers.validUser.id,
        deviceInfo: 'test-agent',
        ipAddress: '127.0.0.1',
        lastActiveAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date('2024-06-01T12:00:00.100Z'), // within 5s of token
      };

      vi.mocked(authRepo.findRefreshToken).mockResolvedValue(storedToken);
      vi.mocked(authRepo.deleteRefreshToken).mockResolvedValue(undefined);
      vi.mocked(sessionRepository.getUserSessions).mockResolvedValue([matchingSession]);
      vi.mocked(sessionRepository.deleteSession).mockResolvedValue(undefined as never);

      // Act
      await authService.logout(refreshToken);

      // Assert
      expect(authRepo.findRefreshToken).toHaveBeenCalledWith(refreshToken);
      expect(authRepo.deleteRefreshToken).toHaveBeenCalledWith(refreshToken);
      expect(sessionRepository.getUserSessions).toHaveBeenCalledWith(storedToken.userId);
      expect(sessionRepository.deleteSession).toHaveBeenCalledWith(matchingSession.id);
    });

    it('should not delete session if no matching createdAt found', async () => {
      // Arrange
      const refreshToken = 'valid-refresh-token';
      const storedToken = {
        ...testRefreshToken,
        token: refreshToken,
        createdAt: new Date('2024-06-01T12:00:00Z'),
      };
      const unmatchedSession = {
        id: 'session-2',
        userId: testUsers.validUser.id,
        deviceInfo: null,
        ipAddress: null,
        lastActiveAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date('2024-05-01T00:00:00Z'), // way off — no match
      };

      vi.mocked(authRepo.findRefreshToken).mockResolvedValue(storedToken);
      vi.mocked(authRepo.deleteRefreshToken).mockResolvedValue(undefined);
      vi.mocked(sessionRepository.getUserSessions).mockResolvedValue([unmatchedSession]);

      // Act
      await authService.logout(refreshToken);

      // Assert
      expect(sessionRepository.deleteSession).not.toHaveBeenCalled();
    });

    it('should not throw error if token deletion fails', async () => {
      // Arrange
      const refreshToken = 'invalid-refresh-token';
      vi.mocked(authRepo.findRefreshToken).mockRejectedValue(new Error('DB error'));

      // Act & Assert
      await expect(authService.logout(refreshToken)).resolves.not.toThrow();
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
