import { describe, it, expect, vi } from 'vitest';
import * as authRepo from '../auth.repo.js';
import { hashPassword, verifyPassword } from '@libs/password.js';
import { login } from '../auth.service.js';

// Own file: the dummy hash is cached at module level, and this test needs that cache empty.
vi.mock('../auth.repo.js');
vi.mock('@libs/auth.js');
vi.mock('@libs/password.js');
vi.mock('../session.repo.js');

const mockRedis = vi.hoisted(() => ({
  ttl: vi.fn().mockResolvedValue(-2),
  incr: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  set: vi.fn(),
  del: vi.fn(),
}));
vi.mock('@libs/redis.js', () => ({ getRedis: (): typeof mockRedis => mockRedis }));

describe('login — dummy hash for unknown emails', () => {
  it('does not cache a failed dummy hash (a lasting 500 would reveal which emails are unknown)', async () => {
    vi.mocked(authRepo.findUserByEmail).mockResolvedValue(null);
    vi.mocked(verifyPassword).mockResolvedValue(false);
    vi.mocked(hashPassword).mockRejectedValueOnce(new Error('argon2 unavailable')).mockResolvedValue('dummy-hash');
    const input = { email: 'nobody@example.com', password: 'Wrong-Passw0rd!' };

    await expect(login(input)).rejects.toThrow('argon2 unavailable');
    // The next attempt computes the hash again and answers like any wrong password.
    await expect(login(input)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(hashPassword).toHaveBeenCalledTimes(2);
    expect(verifyPassword).toHaveBeenCalledWith(input.password, 'dummy-hash');
  });
});
