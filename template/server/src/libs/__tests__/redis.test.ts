import { describe, it, expect } from 'vitest';
import { redisRetryDelay } from '../redis.js';

// The Redis client must never stop reconnecting: ioredis gives up for good
// when the retry strategy returns null, which used to leave a process without
// rate limits, IP blocks and login lockout until it was restarted.

describe('redisRetryDelay', () => {
  it('always returns a delay, even after many attempts (never gives up)', () => {
    for (const attempt of [1, 3, 5, 50, 1000, 100000]) {
      const delay = redisRetryDelay(attempt);
      expect(typeof delay).toBe('number');
      expect(delay).toBeGreaterThan(0);
    }
  });

  it('backs off and caps the wait at 5 seconds', () => {
    expect(redisRetryDelay(1)).toBe(200);
    expect(redisRetryDelay(2)).toBe(400);
    expect(redisRetryDelay(25)).toBe(5000);
    expect(redisRetryDelay(10000)).toBe(5000);
  });
});
