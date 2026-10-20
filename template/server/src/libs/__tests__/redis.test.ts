import { EventEmitter } from 'node:events';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { redisRetryDelay, waitForRedisReady } from '../redis.js';

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

// The production boot waits for Redis this way before refusing to start
// (server.ts): true as soon as the client is ready, false at the deadline.
describe('waitForRedisReady', () => {
  /** A stand-in for the ioredis client: a status and the 'ready' event. */
  const fakeClient = (status: string): EventEmitter & { status: string } => Object.assign(new EventEmitter(), { status });

  afterEach(() => vi.useRealTimers());

  it('true at once when the client is already ready', async () => {
    await expect(waitForRedisReady(10_000, fakeClient('ready') as never)).resolves.toBe(true);
  });

  it('true when the client becomes ready within the wait (here after 5 s)', async () => {
    vi.useFakeTimers();
    const client = fakeClient('reconnecting');
    const waiting = waitForRedisReady(10_000, client as never);
    vi.advanceTimersByTime(5_000);
    client.status = 'ready';
    client.emit('ready');
    await expect(waiting).resolves.toBe(true);
  });

  it('false exactly at the deadline when it never becomes ready, and stops listening', async () => {
    vi.useFakeTimers();
    const client = fakeClient('reconnecting');
    let settled: boolean | undefined;
    void waitForRedisReady(10_000, client as never).then((value) => (settled = value));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(false);
    expect(client.listenerCount('ready')).toBe(0);
  });
});
