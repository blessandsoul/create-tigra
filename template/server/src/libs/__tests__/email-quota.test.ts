import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRedis } from '@libs/redis.js';
import { consumeEmailQuota, emailQuotaKey } from '../email-quota.js';

vi.mock('@libs/redis.js');
vi.mock('@libs/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const redisMock = {
  incr: vi.fn(),
  pexpire: vi.fn(),
  pttl: vi.fn(),
};

describe('consumeEmailQuota — 3 emails per address per hour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRedis).mockReturnValue(redisMock as never);
    redisMock.pexpire.mockResolvedValue(1);
  });

  it('starts the one-hour window on the first email', async () => {
    redisMock.incr.mockResolvedValue(1);
    await expect(consumeEmailQuota('user@example.com')).resolves.toBeUndefined();
    expect(redisMock.pexpire).toHaveBeenCalledWith(emailQuotaKey('user@example.com'), 3_600_000);
  });

  it('allows the third email to the same address', async () => {
    redisMock.incr.mockResolvedValue(3);
    await expect(consumeEmailQuota('user@example.com')).resolves.toBeUndefined();
    expect(redisMock.pexpire).not.toHaveBeenCalled();
  });

  it('refuses the fourth with 429 EMAIL_RATE_LIMITED and the time left in the window', async () => {
    redisMock.incr.mockResolvedValue(4);
    redisMock.pttl.mockResolvedValue(30 * 60 * 1000);
    await expect(consumeEmailQuota('user@example.com')).rejects.toMatchObject({
      statusCode: 429,
      code: 'EMAIL_RATE_LIMITED',
      retryAfterSeconds: 1800,
      message: 'Too many emails were sent to this address. Try again in 30 minutes.',
    });
  });

  it('restarts a window whose expiry was lost instead of blocking forever', async () => {
    redisMock.incr.mockResolvedValue(9);
    redisMock.pttl.mockResolvedValue(-1);
    await expect(consumeEmailQuota('user@example.com')).rejects.toMatchObject({ retryAfterSeconds: 3600 });
    expect(redisMock.pexpire).toHaveBeenCalledWith(emailQuotaKey('user@example.com'), 3_600_000);
  });

  it('keys on a hash of the normalized address, never the raw email', () => {
    const key = emailQuotaKey('User@Example.com ');
    expect(key).toBe(emailQuotaKey('user@example.com'));
    expect(key).toMatch(/^email-quota:[0-9a-f]{64}$/);
    expect(key).not.toContain('example');
  });

  it('lets the email through when Redis is down (fail open)', async () => {
    redisMock.incr.mockRejectedValue(new Error('Connection is closed'));
    await expect(consumeEmailQuota('user@example.com')).resolves.toBeUndefined();
  });
});
