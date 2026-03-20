import { Redis } from 'ioredis';
import { env } from '@config/env.js';
import { logger } from '@libs/logger.js';

let redis: Redis | null = null;
let redisConnected = false;

export function isRedisConnected(): boolean {
  return redisConnected;
}

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: env.REDIS_MAX_RETRIES,
      connectTimeout: env.REDIS_CONNECT_TIMEOUT,
      lazyConnect: true,
      retryStrategy: (times: number) => {
        if (times > env.REDIS_MAX_RETRIES) {
          return null;
        }
        const delay = Math.min(times * 50, 3000);
        logger.debug(`[REDIS] Retry attempt ${times}, waiting ${delay}ms`);
        return delay;
      },
    });

    redis.on('connect', () => {
      redisConnected = true;
      logger.info('[REDIS] Connection established');
    });

    redis.on('error', () => {
      redisConnected = false;
      // Suppressed — connection failure is logged once in connectRedis()
    });

    redis.on('reconnecting', () => {
      // Suppressed — avoid noisy retry logs during startup
    });
  }

  return redis;
}

export async function connectRedis(): Promise<boolean> {
  try {
    const client = getRedis();
    await client.connect();
    return true;
  } catch {
    logger.warn('[REDIS] Connection failed - server will start without Redis');
    return false;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    redisConnected = false;
    logger.info('[REDIS] Disconnected');
  }
}
