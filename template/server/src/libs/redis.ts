import { Redis } from 'ioredis';
import { env } from '@config/env.js';
import { logger } from '@libs/logger.js';

/**
 * Shared Redis client (rate limits, IP blocks, login lockout, reset tokens).
 *
 * Availability contract:
 *  - The connection reconnects FOREVER with capped backoff. It used to give up
 *    after REDIS_MAX_RETRIES attempts, which left a process permanently without
 *    rate limits, IP blocks and login lockout after any Redis blip longer than
 *    ~1 second, until someone restarted it.
 *  - While Redis is down, commands fail IMMEDIATELY (`enableOfflineQueue:
 *    false`) instead of queueing. Every caller already fails open on errors, so
 *    requests keep flowing without waiting ~10 s per command for a reconnect.
 *  - Logs say once when the connection is lost and once when it is back, not on
 *    every retry.
 */

const RETRY_STEP_MS = 200;
const RETRY_MAX_DELAY_MS = 5000;

/** Backoff between reconnect attempts. Never returns null: we never give up. */
export function redisRetryDelay(attempt: number): number {
  return Math.min(attempt * RETRY_STEP_MS, RETRY_MAX_DELAY_MS);
}

let redis: Redis | null = null;
let connectionLost = false;
let closingOnPurpose = false;
const readyListeners = new Set<() => void>();

const LOST_MESSAGE =
  '[REDIS] Connection lost — retrying in the background; rate limits, IP blocks and login lockout fail open until it is back';

/** Log the outage once, whichever event (error or close) reports it first. */
function markConnectionLost(error?: Error): void {
  if (closingOnPurpose) return;
  if (!connectionLost) {
    connectionLost = true;
    logger.warn(error ? { err: error } : {}, LOST_MESSAGE);
  } else if (error) {
    logger.debug({ err: error }, '[REDIS] Still unavailable');
  }
}

/**
 * Run `listener` every time the client becomes ready again after a reconnect
 * (e.g. to restore state a restarted Redis lost). Returns an unsubscribe fn.
 */
export function onRedisReady(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

export function getRedis(): Redis {
  if (!redis) {
    closingOnPurpose = false;
    redis = new Redis(env.REDIS_URL, {
      // Retries for a single command; the connection itself retries forever.
      maxRetriesPerRequest: env.REDIS_MAX_RETRIES,
      connectTimeout: env.REDIS_CONNECT_TIMEOUT,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: (times: number): number => {
        const delay = redisRetryDelay(times);
        logger.debug(`[REDIS] Retry attempt ${times}, waiting ${delay}ms`);
        return delay;
      },
    });

    redis.on('ready', () => {
      if (connectionLost) {
        connectionLost = false;
        logger.info('[REDIS] Reconnected — Redis-backed protections are active again');
        for (const listener of readyListeners) {
          try {
            listener();
          } catch (error) {
            logger.warn({ err: error }, '[REDIS] Ready listener failed');
          }
        }
      } else {
        logger.info('[REDIS] Connection established');
      }
    });

    redis.on('error', (error: Error) => markConnectionLost(error));

    // A close without an error (e.g. Redis restarted cleanly) is also an outage.
    redis.on('close', () => markConnectionLost());
  }

  return redis;
}

export async function connectRedis(): Promise<boolean> {
  try {
    const client = getRedis();
    await client.connect();
    return true;
  } catch (error) {
    logger.warn('[REDIS] Initial connection failed — server starts without Redis and keeps retrying in the background');
    logger.debug(error);
    return false;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    const client = redis;
    redis = null;
    closingOnPurpose = true;
    readyListeners.clear();
    if (client.status === 'ready') {
      await client.quit();
    } else {
      // Not connected (Redis down / still retrying): quit() would be rejected
      // because the offline queue is off. disconnect() stops the retry loop.
      client.disconnect();
    }
    logger.info('[REDIS] Disconnected');
  }
}
