import { describe, it, expect, vi } from 'vitest';
import { getRedis } from '@libs/redis.js';
import { assertRedisReady } from '../redis-required.js';

vi.mock('@libs/redis.js');

describe('assertRedisReady', () => {
  it('passes while Redis is connected', () => {
    vi.mocked(getRedis).mockReturnValue({ status: 'ready' } as never);
    expect(() => assertRedisReady('Password reset')).not.toThrow();
  });

  it.each(['reconnecting', 'connecting', 'end', 'close', 'wait'])('answers 503 while Redis is %s', (status) => {
    vi.mocked(getRedis).mockReturnValue({ status } as never);
    expect(() => assertRedisReady('Password reset')).toThrow(
      expect.objectContaining({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Password reset is temporarily unavailable. Please try again in a few minutes.',
      }),
    );
  });

  it('answers 503 when the client cannot even be created', () => {
    vi.mocked(getRedis).mockImplementation(() => {
      throw new Error('bad REDIS_URL');
    });
    expect(() => assertRedisReady('Email verification')).toThrow(expect.objectContaining({ statusCode: 503 }));
  });
});
