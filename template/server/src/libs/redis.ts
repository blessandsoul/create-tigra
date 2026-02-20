import { Redis } from 'ioredis';
import { env } from '@config/env.js';
import { logger } from '@libs/logger.js';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: env.REDIS_MAX_RETRIES,
      connectTimeout: env.REDIS_CONNECT_TIMEOUT,
      lazyConnect: true,
      retryStrategy: (times: number) => {
        // Exponential backoff with max delay of 3 seconds
        if (times > env.REDIS_MAX_RETRIES) {
          // Stop retrying after max retries
          logger.error('[REDIS] Max retries reached, giving up');
          return null;
        }
        const delay = Math.min(times * 50, 3000);
        logger.debug(`[REDIS] Retry attempt ${times}, waiting ${delay}ms`);
        return delay;
      },
    });

    redis.on('connect', () => {
      logger.info('[REDIS] Connection established');
    });

    redis.on('error', (error: Error) => {
      logger.warn({ err: error }, '[REDIS] Connection error');
    });

    redis.on('reconnecting', (delay: number) => {
      logger.info({ delay }, '[REDIS] Reconnecting');
    });
  }

  return redis;
}

export async function connectRedis(): Promise<boolean> {
  try {
    const client = getRedis();
    await client.connect();
    return true;
  } catch (error) {
    logger.warn('[REDIS] Connection failed — server will start without Redis');
    logger.debug(error);
    return false;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    logger.info('[REDIS] Disconnected');
  }
}
