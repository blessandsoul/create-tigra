import { Redis } from 'ioredis';
import { config } from 'dotenv';

// Load environment variables
config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function flushRateLimits(): Promise<void> {
  console.log('Connecting to Redis...');
  const redis = new Redis(REDIS_URL);

  try {
    // Find all rate limit keys (Fastify rate-limit uses 'fastify-rate-limit:' prefix by default)
    const rateLimitKeys = await redis.keys('fastify-rate-limit:*');

    if (rateLimitKeys.length === 0) {
      console.log('No rate limit keys found. Redis is clean!');
      return;
    }

    console.log(`Found ${rateLimitKeys.length} rate limit keys`);

    // Delete all rate limit keys
    const result = await redis.del(...rateLimitKeys);
    console.log(`Successfully deleted ${result} rate limit keys`);
    console.log('Rate limits have been reset. You can continue testing!');
  } catch (error) {
    console.error('Error flushing rate limits:', error);
    process.exit(1);
  } finally {
    await redis.quit();
    console.log('Disconnected from Redis');
  }
}

// Run the script
flushRateLimits().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
