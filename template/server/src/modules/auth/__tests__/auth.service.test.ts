import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as authService from '../auth.service.js';
import * as authRepo from '../auth.repo.js';
import * as authLib from '@libs/auth.js';
import { hashPassword, verifyPassword } from '@libs/password.js';
import { ConflictError, UnauthorizedError, ForbiddenError, NotFoundError } from '@shared/errors/errors.js';
import { testUsers, testRefreshToken, testSession, resetMocks } from '@/test/setup.js';
import { sessionRepository } from '../session.repo.js';
import { env } from '@config/env.js';

/** Run `fn` with REQUIRE_USER_VERIFICATION switched on, then restore it. */
async function withVerificationRequired<T>(fn: () => Promise<T>): Promise<T> {
  const previous = env.REQUIRE_USER_VERIFICATION;
  env.REQUIRE_USER_VERIFICATION = true;
  try {
    return await fn();
  } finally {
    env.REQUIRE_USER_VERIFICATION = previous;
  }
}

// Mock dependencies
vi.mock('../auth.repo.js');
vi.mock('@libs/auth.js');
vi.mock('@libs/password.js');
vi.mock('../session.repo.js');

// In-memory Redis stub — account lockout (email+IP) uses Redis. Tests must
// never require a live Redis instance.
const mockRedis = vi.hoisted(() => ({
  status: 'ready',
  exists: vi.fn(),
  ttl: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
  set: vi.fn(),
  get: vi.fn(),
  getdel: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@libs/redis.js', () => ({
  getRedis: (): typeof mockRedis => mockRedis,
}));

describe('Auth Service', () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
    // Default Redis behavior: connected, nothing locked (TTL -2 = no key), first failure
    mockRedis.status = 'ready';
    mockRedis.exists.mockResolvedValue(0);
    mockRedis.ttl.mockResolvedValue(-2);
    // Unknown emails are checked against a dummy hash (equal timing)
    vi.mocked(hashPassword).mockResolvedValue('dummy-hash');
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
    // refresh() requires the token's session to exist and be unexpired
    vi.mocked(sessionRepository.getSessionById).mockResolvedValue(testSession);
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
        emailVerifiedAt: expect.any(Date),
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

    it('should create an unverified (but never banned) user and issue no session when verification is required', async () => {
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(null);
      vi.mocked(authRepo.findDeletedUserByEmail).mockResolvedValue(null);
      vi.mocked(hashPassword).mockResolvedValue('$2a$12$hashedpassword');
      vi.mocked(authRepo.createUser).mockResolvedValue({
        ...testUsers.unverifiedUser,
        email: validRegisterInput.email,
      });

      const result = await withVerificationRequired(() => authService.register(validRegisterInput));

      // isActive is not passed at all: the ban switch keeps its default (true).
      expect(authRepo.createUser).toHaveBeenCalledWith({
        email: validRegisterInput.email,
        password: '$2a$12$hashedpassword',
        firstName: validRegisterInput.firstName,
        lastName: validRegisterInput.lastName,
        emailVerifiedAt: null,
      });
      expect(result.requiresVerification).toBe(true);
      expect(result.accessToken).toBeUndefined();
      expect(result.user.emailVerifiedAt).toBeNull();
      expect(authLib.signAccessToken).not.toHaveBeenCalled();
      expect(sessionRepository.createSession).not.toHaveBeenCalled();
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
      await expect(authService.register(validRegisterInput)).rejects.toThrow(
        'An account with this email was recently deleted and cannot be registered yet.',
      );
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

    it('should throw UnauthorizedError if user not found, after the same password check and failure count', async () => {
      // Arrange
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(null);
      vi.mocked(verifyPassword).mockResolvedValue(false);

      // Act & Assert
      await expect(authService.login(validLoginInput)).rejects.toThrow(UnauthorizedError);
      await expect(authService.login(validLoginInput)).rejects.toThrow('Invalid email or password');
      expect(authRepo.findDeletedUserByEmail).not.toHaveBeenCalled();
      // Same cost as a wrong password on a real account: no timing hint about registered emails
      expect(verifyPassword).toHaveBeenCalledWith(validLoginInput.password, 'dummy-hash');
      // Counted like a real failure, so the lock cannot reveal which emails exist
      expect(mockRedis.incr).toHaveBeenCalledWith(`login-fail:${validLoginInput.email}:unknown`);
    });

    it('should not restore or authenticate a soft-deleted account with correct credentials', async () => {
      // findUserByEmail excludes soft-deleted records, so login must stop before
      // password verification, token creation, or session creation.
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(null);
      vi.mocked(authRepo.findDeletedUserByEmail).mockResolvedValue({
        ...testUsers.validUser,
        deletedAt: new Date('2024-02-01T00:00:00Z'),
        isActive: false,
      });
      vi.mocked(verifyPassword).mockResolvedValue(true);

      await expect(authService.login(validLoginInput)).rejects.toThrow(UnauthorizedError);
      await expect(authService.login(validLoginInput)).rejects.toThrow('Invalid email or password');
      expect(authRepo.findDeletedUserByEmail).not.toHaveBeenCalled();
      // Only the dummy hash is checked, never the deleted account's own password
      expect(verifyPassword).not.toHaveBeenCalledWith(validLoginInput.password, testUsers.validUser.password);
      expect(authLib.signAccessToken).not.toHaveBeenCalled();
      expect(authLib.generateRefreshToken).not.toHaveBeenCalled();
      expect(sessionRepository.createSession).not.toHaveBeenCalled();
      expect(authRepo.createRefreshToken).not.toHaveBeenCalled();
    });

    it('should not reveal that an account is banned when the password is wrong', async () => {
      // Account state is checked only after the password, so a caller without
      // the password gets the same answer as for any wrong password.
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(testUsers.inactiveUser);
      vi.mocked(verifyPassword).mockResolvedValue(false);

      await expect(authService.login(validLoginInput)).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
      expect(verifyPassword).toHaveBeenCalled();
    });

    it('should reject a banned account with ACCOUNT_DEACTIVATED and issue no session', async () => {
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(testUsers.inactiveUser);
      vi.mocked(verifyPassword).mockResolvedValue(true);

      await expect(authService.login(validLoginInput)).rejects.toThrow(ForbiddenError);
      await expect(authService.login(validLoginInput)).rejects.toMatchObject({
        code: 'ACCOUNT_DEACTIVATED',
      });
      expect(authLib.signAccessToken).not.toHaveBeenCalled();
      expect(sessionRepository.createSession).not.toHaveBeenCalled();
    });

    it('should reject an unverified account with EMAIL_NOT_VERIFIED while verification is required', async () => {
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(testUsers.unverifiedUser);
      vi.mocked(verifyPassword).mockResolvedValue(true);

      await expect(
        withVerificationRequired(() => authService.login(validLoginInput)),
      ).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
      expect(authLib.signAccessToken).not.toHaveBeenCalled();
      expect(sessionRepository.createSession).not.toHaveBeenCalled();
    });

    it('should report a ban (not "verify your email") for a banned account that is also unverified', async () => {
      // Verifying an email can never lift a ban, so the ban must win.
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue({
        ...testUsers.unverifiedUser,
        isActive: false,
      });
      vi.mocked(verifyPassword).mockResolvedValue(true);

      await expect(
        withVerificationRequired(() => authService.login(validLoginInput)),
      ).rejects.toMatchObject({ code: 'ACCOUNT_DEACTIVATED' });
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

    it('should answer 429 LOGIN_LOCKED with the wait time while the email+IP pair is locked, without checking the password', async () => {
      // Arrange
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(testUsers.validUser);
      mockRedis.ttl.mockResolvedValue(600); // lock key present for this pair, 10 min left

      // Act & Assert — even the right password gets the locked answer
      await expect(
        authService.login({ ...loginInput, password: 'Password123!' }, 'test-agent', attackerIp),
      ).rejects.toMatchObject({
        statusCode: 429,
        code: 'LOGIN_LOCKED',
        retryAfterSeconds: 600,
        message: 'Too many failed sign-in attempts. Try again in 10 minutes.',
      });
      expect(mockRedis.ttl).toHaveBeenCalledWith(`login-lock:test@example.com:${attackerIp}`);
      expect(verifyPassword).not.toHaveBeenCalled();
      expect(authRepo.findUserByEmail).not.toHaveBeenCalled(); // checked before the lookup
    });

    it('should lock an unknown email exactly like a real one (no account enumeration)', async () => {
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(null);
      vi.mocked(verifyPassword).mockResolvedValue(false);
      mockRedis.incr.mockResolvedValue(15);

      await expect(authService.login(loginInput, 'test-agent', attackerIp)).rejects.toMatchObject({
        statusCode: 429,
        code: 'LOGIN_LOCKED',
        retryAfterSeconds: 15 * 60,
      });
      expect(mockRedis.set).toHaveBeenCalledWith(`login-lock:test@example.com:${attackerIp}`, '1', 'EX', 15 * 60);
    });

    it('should NOT lock out the same email from a different IP (no remote lockout DoS)', async () => {
      // Arrange — lock exists only for the attacker's IP; victim logs in from
      // their own IP and Redis reports no lock for that pair.
      const victimIp = '198.51.100.42';
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(testUsers.validUser);
      mockRedis.ttl.mockResolvedValue(-2);
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
      expect(mockRedis.ttl).toHaveBeenCalledWith(`login-lock:test@example.com:${victimIp}`);
      expect(result.accessToken).toBe('access');
    });

    it('should record a failed attempt against the email+IP pair on bad password', async () => {
      // Arrange
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(testUsers.validUser);
      vi.mocked(verifyPassword).mockResolvedValue(false);
      mockRedis.incr.mockResolvedValue(14); // one below the first lock

      // Act & Assert
      await expect(authService.login(loginInput, 'test-agent', attackerIp)).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
      expect(mockRedis.incr).toHaveBeenCalledWith(`login-fail:test@example.com:${attackerIp}`);
      // The count is forgotten an hour after the last failure
      expect(mockRedis.expire).toHaveBeenCalledWith(`login-fail:test@example.com:${attackerIp}`, 3600);
      expect(mockRedis.set).not.toHaveBeenCalled(); // no lock yet
    });

    it('should lock for 15 minutes on the 15th failure and say so on that same attempt', async () => {
      // Arrange
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(testUsers.validUser);
      vi.mocked(verifyPassword).mockResolvedValue(false);
      mockRedis.incr.mockResolvedValue(15); // hits the first threshold

      // Act & Assert
      await expect(authService.login(loginInput, 'test-agent', attackerIp)).rejects.toMatchObject({
        statusCode: 429,
        code: 'LOGIN_LOCKED',
        retryAfterSeconds: 15 * 60,
        message: 'Too many failed sign-in attempts. Try again in 15 minutes.',
      });
      expect(mockRedis.set).toHaveBeenCalledWith(
        `login-lock:test@example.com:${attackerIp}`,
        '1',
        'EX',
        15 * 60,
      );
    });

    it('should not re-lock between the steps, and lock for 1 hour on the 30th failure', async () => {
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(testUsers.validUser);
      vi.mocked(verifyPassword).mockResolvedValue(false);

      mockRedis.incr.mockResolvedValue(16);
      await expect(authService.login(loginInput, 'test-agent', attackerIp)).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
      expect(mockRedis.set).not.toHaveBeenCalled();

      mockRedis.incr.mockResolvedValue(30);
      await expect(authService.login(loginInput, 'test-agent', attackerIp)).rejects.toMatchObject({
        code: 'LOGIN_LOCKED',
        retryAfterSeconds: 3600,
      });
      expect(mockRedis.set).toHaveBeenCalledWith(`login-lock:test@example.com:${attackerIp}`, '1', 'EX', 3600);
    });

    it('lockSecondsForFailure: 15 → 15 min, 30 and every 15th after → 1 h, others → none', () => {
      expect(authService.lockSecondsForFailure(14)).toBeNull();
      expect(authService.lockSecondsForFailure(15)).toBe(900);
      expect(authService.lockSecondsForFailure(16)).toBeNull();
      expect(authService.lockSecondsForFailure(29)).toBeNull();
      expect(authService.lockSecondsForFailure(30)).toBe(3600);
      expect(authService.lockSecondsForFailure(45)).toBe(3600);
    });

    it('should fail open and allow login when Redis is unavailable', async () => {
      // Arrange — Redis down: lockout checks must not block all logins
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(testUsers.validUser);
      mockRedis.ttl.mockRejectedValue(new Error('Redis down'));
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

  describe('refresh', () => {
    const validRefreshToken = 'valid-refresh-token';

    it('should reject and delete a token whose session no longer exists', async () => {
      // e.g. the session was force-expired by an admin or removed by the cleanup job
      vi.mocked(authRepo.findRefreshToken).mockResolvedValue({
        ...testRefreshToken,
        sessionId: testSession.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      vi.mocked(sessionRepository.getSessionById).mockResolvedValue(null);

      await expect(authService.refresh(validRefreshToken)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
      expect(authRepo.deleteRefreshToken).toHaveBeenCalledWith(validRefreshToken);
      expect(authRepo.rotateRefreshToken).not.toHaveBeenCalled();
      expect(authLib.signAccessToken).not.toHaveBeenCalled();
    });

    it('should reject a token whose session has expired', async () => {
      vi.mocked(authRepo.findRefreshToken).mockResolvedValue({
        ...testRefreshToken,
        sessionId: testSession.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      vi.mocked(sessionRepository.getSessionById).mockResolvedValue({
        ...testSession,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(authService.refresh(validRefreshToken)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
      expect(authRepo.rotateRefreshToken).not.toHaveBeenCalled();
    });

    it('should reject a legacy token that has no session at all', async () => {
      vi.mocked(authRepo.findRefreshToken).mockResolvedValue({
        ...testRefreshToken,
        sessionId: null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      await expect(authService.refresh(validRefreshToken)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    });

    it('should successfully refresh tokens with valid refresh token', async () => {
      // Arrange
      const newAccessToken = 'new-access-token';
      const newRefreshToken = 'new-refresh-token';
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const storedToken = {
        ...testRefreshToken,
        sessionId: testSession.id,
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
        sessionId: testSession.id,
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
        sessionId: testSession.id,
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
        sessionId: testSession.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
      vi.mocked(authRepo.findRefreshToken).mockResolvedValue(storedToken);
      vi.mocked(authRepo.findUserById).mockResolvedValue(null);

      // Act & Assert
      await expect(authService.refresh(validRefreshToken)).rejects.toThrow(UnauthorizedError);
      await expect(authService.refresh(validRefreshToken)).rejects.toThrow('User not found or disabled');
    });

    it('should refuse to refresh a banned account', async () => {
      // Arrange
      const storedToken = {
        ...testRefreshToken,
        sessionId: testSession.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
      vi.mocked(authRepo.findRefreshToken).mockResolvedValue(storedToken);
      vi.mocked(authRepo.findUserById).mockResolvedValue(testUsers.inactiveUser);

      // Act & Assert
      await expect(authService.refresh(validRefreshToken)).rejects.toThrow(ForbiddenError);
      await expect(authService.refresh(validRefreshToken)).rejects.toMatchObject({
        code: 'ACCOUNT_DEACTIVATED',
      });
      expect(authLib.signAccessToken).not.toHaveBeenCalled();
    });

    it('should revoke ALL refresh tokens and sessions when token reuse is detected', async () => {
      // Regression test for refresh-token-reuse family revocation:
      // the token was found, but the atomic rotation reports it was already
      // consumed by a concurrent request — two parties presented the same
      // single-use token. The whole family must be revoked, because whichever
      // party redeemed it first (possibly an attacker) holds a valid token.
      const storedToken = {
        ...testRefreshToken,
        sessionId: testSession.id,
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
        sessionId: testSession.id,
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

  describe('password reset while Redis is down', () => {
    // Reset tokens live in Redis: the answer must be a clear 503 for every
    // address, decided before any lookup (so it reveals nothing).
    it('forgotPassword answers 503 SERVICE_UNAVAILABLE before looking the user up', async () => {
      mockRedis.status = 'reconnecting';
      await expect(authService.forgotPassword('anyone@example.com')).rejects.toMatchObject({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Password reset is temporarily unavailable. Please try again in a few minutes.',
      });
      expect(authRepo.findUserByEmail).not.toHaveBeenCalled();
    });

    it('resetPassword answers 503 SERVICE_UNAVAILABLE instead of failing on the token lookup', async () => {
      mockRedis.status = 'reconnecting';
      await expect(authService.resetPassword('some-token', 'New-Passw0rd-123!')).rejects.toMatchObject({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
      });
      expect(mockRedis.getdel).not.toHaveBeenCalled();
    });

    it('forgotPassword still answers normally while Redis is connected (unknown email: no error)', async () => {
      vi.mocked(authRepo.findUserByEmail).mockResolvedValue(null);
      await expect(authService.forgotPassword('nobody@example.com')).resolves.toBeUndefined();
    });
  });

  describe('resetPassword', () => {
    it('consumes the token in one step (GETDEL), changes the password and ends all sessions', async () => {
      mockRedis.getdel.mockResolvedValue(testUsers.validUser.id);
      vi.mocked(authRepo.findUserById).mockResolvedValue(testUsers.validUser);
      vi.mocked(hashPassword).mockResolvedValue('new-hash');

      await authService.resetPassword('reset-token', 'New-Passw0rd-123!');

      expect(mockRedis.getdel).toHaveBeenCalledTimes(1);
      expect(mockRedis.get).not.toHaveBeenCalled();
      expect(authRepo.updateUserPassword).toHaveBeenCalledWith(testUsers.validUser.id, 'new-hash');
      expect(mockRedis.del).toHaveBeenCalledWith(`pw-reset-user:${testUsers.validUser.id}`);
      expect(sessionRepository.deleteAllUserSessions).toHaveBeenCalledWith(testUsers.validUser.id);
      expect(authRepo.deleteRefreshTokensByUserId).toHaveBeenCalledWith(testUsers.validUser.id);
    });

    it('the same link used twice at once changes the password only once', async () => {
      // Redis hands the token to the first GETDEL only.
      mockRedis.getdel.mockResolvedValueOnce(testUsers.validUser.id).mockResolvedValueOnce(null);
      vi.mocked(authRepo.findUserById).mockResolvedValue(testUsers.validUser);
      vi.mocked(hashPassword).mockResolvedValue('new-hash');

      const results = await Promise.allSettled([
        authService.resetPassword('reset-token', 'New-Passw0rd-123!'),
        authService.resetPassword('reset-token', 'New-Passw0rd-123!'),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ statusCode: 400, code: 'INVALID_RESET_TOKEN' });
      expect(authRepo.updateUserPassword).toHaveBeenCalledTimes(1);
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
