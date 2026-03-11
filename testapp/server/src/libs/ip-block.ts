/**
 * IP Blocking Service
 *
 * Two-tier IP blocking:
 * - Permanent blocks: DB (source of truth) + Redis SET (hot cache). Admin-managed via API.
 * - Auto-blocks: Redis ZSET with expiry timestamps (triggered by excessive rate-limit violations)
 *
 * Design decisions:
 * - DB is the source of truth for permanent blocks — survives Redis restarts
 * - Redis is the hot cache — all runtime checks hit Redis only (O(1))
 * - On server boot, syncBlockedIpsToRedis() loads all permanent blocks from DB into Redis
 * - Fails open: if Redis is down, requests are NOT blocked (availability > security for rate limiting)
 * - Lazy cleanup: expired auto-blocks are removed on check, no separate cleanup job needed
 */

import { prisma } from '@libs/prisma.js';
import { getRedis } from '@libs/redis.js';
import { logger } from '@libs/logger.js';
import { ConflictError } from '@shared/errors/errors.js';

// Redis keys
const BLOCKED_IPS_KEY = 'blocked_ips';
const AUTO_BLOCKED_KEY = 'auto_blocked_ips';
const VIOLATION_PREFIX = 'rl_violations:';

// Auto-block thresholds
const AUTO_BLOCK_THRESHOLD = 10;         // violations before auto-block
const AUTO_BLOCK_WINDOW_SECONDS = 300;   // 5-minute sliding window
const AUTO_BLOCK_DURATION_SECONDS = 3600; // block for 1 hour

/**
 * Sync all permanent blocked IPs from DB to Redis.
 * Called once during server startup.
 */
export async function syncBlockedIpsToRedis(): Promise<void> {
  try {
    const blockedIps = await prisma.blockedIp.findMany({ select: { ip: true } });

    const redis = getRedis();

    // Clear stale Redis state and repopulate from DB
    await redis.del(BLOCKED_IPS_KEY);

    if (blockedIps.length > 0) {
      await redis.sadd(BLOCKED_IPS_KEY, ...blockedIps.map((b) => b.ip));
    }

    logger.info(`[IP-BLOCK] Synced ${blockedIps.length} blocked IPs from DB to Redis`);
  } catch (error) {
    logger.warn('[IP-BLOCK] Failed to sync blocked IPs from DB to Redis — permanent blocks may not be enforced until next restart');
    logger.debug(error);
  }
}

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
 * Block an IP permanently. Writes to DB (source of truth) + Redis (hot cache).
 *
 * @param ip - IP address to block
 * @param blockedBy - Admin user ID who initiated the block
 * @param reason - Optional reason for the block
 */
export async function blockIp(
  ip: string,
  blockedBy: string,
  reason?: string,
): Promise<{ id: string; ip: string; reason: string | null; blockedBy: string; createdAt: Date }> {
  // Write to DB (source of truth)
  const existing = await prisma.blockedIp.findUnique({ where: { ip } });
  if (existing) {
    throw new ConflictError('IP is already blocked', 'IP_ALREADY_BLOCKED');
  }

  const blocked = await prisma.blockedIp.create({
    data: { ip, blockedBy, reason: reason ?? null },
  });

  // Sync to Redis cache
  try {
    const redis = getRedis();
    await redis.sadd(BLOCKED_IPS_KEY, ip);
  } catch {
    logger.warn({ ip }, '[IP-BLOCK] Failed to sync block to Redis — will be synced on next restart');
  }

  logger.info({ ip, blockedBy, reason }, '[IP-BLOCK] IP permanently blocked');
  return blocked;
}

/**
 * Unblock an IP. Removes from DB + Redis + auto-block list.
 *
 * @param ip - IP address to unblock
 */
export async function unblockIp(ip: string): Promise<void> {
  // Remove from DB
  await prisma.blockedIp.deleteMany({ where: { ip } });

  // Remove from Redis (both permanent and auto-block)
  try {
    const redis = getRedis();
    await redis.srem(BLOCKED_IPS_KEY, ip);
    await redis.zrem(AUTO_BLOCKED_KEY, ip);
  } catch {
    logger.warn({ ip }, '[IP-BLOCK] Failed to sync unblock to Redis — will be synced on next restart');
  }

  logger.info({ ip }, '[IP-BLOCK] IP unblocked');
}

/**
 * List all currently blocked IPs (permanent from DB + active auto-blocks from Redis).
 */
export async function getBlockedIps(): Promise<{
  permanent: { id: string; ip: string; reason: string | null; blockedBy: string; createdAt: Date }[];
  autoBlocked: string[];
}> {
  // Permanent blocks from DB (source of truth)
  const permanent = await prisma.blockedIp.findMany({
    select: { id: true, ip: true, reason: true, blockedBy: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  // Auto-blocks from Redis
  let autoBlocked: string[] = [];
  try {
    const redis = getRedis();
    const nowSeconds = Date.now() / 1000;
    autoBlocked = await redis.zrangebyscore(AUTO_BLOCKED_KEY, nowSeconds, '+inf');
  } catch {
    logger.warn('[IP-BLOCK] Redis unavailable, cannot retrieve auto-blocked IPs');
  }

  return { permanent, autoBlocked };
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
