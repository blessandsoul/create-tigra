/**
 * IP Blocking Service
 *
 * Redis-backed IP blocking with two tiers:
 * - Permanent blocks: Redis SET (admin-managed via API)
 * - Auto-blocks: Redis ZSET with expiry timestamps (triggered by excessive rate-limit violations)
 *
 * Design decisions:
 * - Fails open: if Redis is down, requests are NOT blocked (availability > security for rate limiting)
 * - O(1) lookups: both SISMEMBER and ZSCORE are constant-time operations
 * - Lazy cleanup: expired auto-blocks are removed on check, no separate cleanup job needed
 */

import { getRedis } from '@libs/redis.js';
import { logger } from '@libs/logger.js';

// Redis keys
const BLOCKED_IPS_KEY = 'blocked_ips';
const AUTO_BLOCKED_KEY = 'auto_blocked_ips';
const VIOLATION_PREFIX = 'rl_violations:';

// Auto-block thresholds
const AUTO_BLOCK_THRESHOLD = 10;         // violations before auto-block
const AUTO_BLOCK_WINDOW_SECONDS = 300;   // 5-minute sliding window
const AUTO_BLOCK_DURATION_SECONDS = 3600; // block for 1 hour

/**
 * Check if an IP is blocked (permanent or auto-blocked).
 *
 * @param ip - IP address to check
 * @returns true if blocked, false otherwise (including Redis failures)
 */
export async function isIpBlocked(ip: string): Promise<boolean> {
  try {
    const redis = getRedis();

    // Check permanent block list
    const permanent = await redis.sismember(BLOCKED_IPS_KEY, ip);
    if (permanent === 1) return true;

    // Check auto-block list (score = expiry Unix timestamp)
    const score = await redis.zscore(AUTO_BLOCKED_KEY, ip);
    if (score) {
      const expiresAt = Number(score);
      if (expiresAt > Date.now() / 1000) return true;

      // Expired — clean up lazily
      await redis.zrem(AUTO_BLOCKED_KEY, ip);
    }

    return false;
  } catch {
    // Fail open: if Redis is down, don't block
    logger.warn('[IP-BLOCK] Redis unavailable, skipping IP block check');
    return false;
  }
}

/**
 * Add an IP to the permanent block list (admin-managed).
 *
 * @param ip - IP address to block
 */
export async function blockIp(ip: string): Promise<void> {
  const redis = getRedis();
  await redis.sadd(BLOCKED_IPS_KEY, ip);
  logger.info({ ip }, '[IP-BLOCK] IP permanently blocked');
}

/**
 * Remove an IP from the permanent block list.
 *
 * @param ip - IP address to unblock
 */
export async function unblockIp(ip: string): Promise<void> {
  const redis = getRedis();
  await redis.srem(BLOCKED_IPS_KEY, ip);
  // Also remove from auto-block list if present
  await redis.zrem(AUTO_BLOCKED_KEY, ip);
  logger.info({ ip }, '[IP-BLOCK] IP unblocked');
}

/**
 * List all currently blocked IPs (permanent + active auto-blocks).
 *
 * @returns Object with permanent and autoBlocked arrays
 */
export async function getBlockedIps(): Promise<{
  permanent: string[];
  autoBlocked: string[];
}> {
  const redis = getRedis();
  const nowSeconds = Date.now() / 1000;

  const permanent = await redis.smembers(BLOCKED_IPS_KEY);

  // Get auto-blocked IPs that haven't expired yet
  const autoBlockedWithScores = await redis.zrangebyscore(
    AUTO_BLOCKED_KEY,
    nowSeconds,
    '+inf',
  );

  return { permanent, autoBlocked: autoBlockedWithScores };
}

/**
 * Record a rate-limit violation for an IP.
 *
 * If the IP exceeds AUTO_BLOCK_THRESHOLD violations within
 * AUTO_BLOCK_WINDOW_SECONDS, it gets auto-blocked for
 * AUTO_BLOCK_DURATION_SECONDS.
 *
 * Called from the rate-limit `onExceeded` callback.
 *
 * @param ip - IP address that violated rate limit
 */
export async function recordRateLimitViolation(ip: string): Promise<void> {
  try {
    const redis = getRedis();
    const key = `${VIOLATION_PREFIX}${ip}`;

    const count = await redis.incr(key);

    // Set TTL on first violation (sliding window)
    if (count === 1) {
      await redis.expire(key, AUTO_BLOCK_WINDOW_SECONDS);
    }

    if (count >= AUTO_BLOCK_THRESHOLD) {
      // Auto-block: add to ZSET with expiry timestamp as score
      const expiresAt = Math.floor(Date.now() / 1000) + AUTO_BLOCK_DURATION_SECONDS;
      await redis.zadd(AUTO_BLOCKED_KEY, expiresAt, ip);
      await redis.del(key); // Reset violation counter

      logger.warn(
        { ip, violations: count, blockedForSeconds: AUTO_BLOCK_DURATION_SECONDS },
        '[IP-BLOCK] Auto-blocked IP due to excessive rate-limit violations',
      );
    }
  } catch {
    // Non-critical: don't break the request if violation tracking fails
    logger.warn('[IP-BLOCK] Failed to record rate-limit violation');
  }
}
