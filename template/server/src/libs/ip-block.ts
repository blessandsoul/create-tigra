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
 * - One spelling: every stored or removed block is the canonical form
 *   (normalizeIp, libs/ip-address.ts), the same string the visitor's requests
 *   are checked with. A block typed as `2001:DB8::1` used to never match.
 * - No self-lockout: a block applies to every route, the unblock route
 *   included, so an admin may not block the address they are using, nor a
 *   private/reserved address (a proxy or Docker address would block everyone).
 */

import { env } from '@config/env.js';
import { prisma, isPrismaUniqueViolation } from '@libs/prisma.js';
import { getRedis } from '@libs/redis.js';
import { logger } from '@libs/logger.js';
import { ConflictError, ValidationError } from '@shared/errors/errors.js';
import { isPrivateOrReservedIp } from '@libs/url-safety.js';
import { normalizeIp } from '@libs/ip-address.js';

// Redis keys
const BLOCKED_IPS_KEY = 'blocked_ips';
const AUTO_BLOCKED_KEY = 'auto_blocked_ips';
const VIOLATION_PREFIX = 'rl_violations:';

// Auto-block thresholds — env-configurable (see .env.example).
// The threshold default is deliberately high (20): auto-block must catch
// SUSTAINED abuse, not a single burst. Rate-limit counting happens before
// validation, so a retry-looping but legitimate client (or a NAT'd office
// sharing one egress IP) can rack up violations quickly — see the self-ban
// interaction note in src/config/rate-limit.config.ts before lowering it.
const AUTO_BLOCK_THRESHOLD = env.IP_AUTO_BLOCK_THRESHOLD;                 // violations before auto-block (default 20)
const AUTO_BLOCK_WINDOW_SECONDS = env.IP_AUTO_BLOCK_WINDOW_SECONDS;       // sliding window (default 300 = 5 min)
const AUTO_BLOCK_DURATION_SECONDS = env.IP_AUTO_BLOCK_DURATION_SECONDS;   // block duration (default 3600 = 1 hour)

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
 * Block state of one IP.
 * - `permanent`: an admin block, no end time.
 * - `retryAfterSeconds`: set for an automatic block, the whole seconds until it
 *   ends, so the 403 can tell the visitor when to come back.
 */
export type IpBlock =
  | { blocked: false }
  | { blocked: true; permanent: true }
  | { blocked: true; permanent: false; retryAfterSeconds: number };

/**
 * Check if an IP is blocked (permanent or auto-blocked).
 *
 * @param ip - IP address to check
 * @returns the block state; `{ blocked: false }` also on Redis failures (fail open)
 */
export async function getIpBlock(ip: string): Promise<IpBlock> {
  try {
    const redis = getRedis();

    // Check permanent block list
    const permanent = await redis.sismember(BLOCKED_IPS_KEY, ip);
    if (permanent === 1) return { blocked: true, permanent: true };

    // Check auto-block list (score = expiry Unix timestamp)
    const score = await redis.zscore(AUTO_BLOCKED_KEY, ip);
    if (score) {
      const secondsLeft = Number(score) - Date.now() / 1000;
      if (secondsLeft > 0) {
        return { blocked: true, permanent: false, retryAfterSeconds: Math.max(1, Math.ceil(secondsLeft)) };
      }

      // Expired — clean up lazily
      await redis.zrem(AUTO_BLOCKED_KEY, ip);
    }

    return { blocked: false };
  } catch {
    // Fail open: if Redis is down, don't block
    logger.warn('[IP-BLOCK] Redis unavailable, skipping IP block check');
    return { blocked: false };
  }
}

/**
 * Block an IP permanently. Writes to DB (source of truth) + Redis (hot cache).
 *
 * @param rawIp - IP address to block, in any spelling (stored canonical)
 * @param blockedBy - Admin user ID who initiated the block
 * @param reason - Optional reason for the block
 * @param requesterIp - The admin's own resolved address (getClientIp), never blockable
 * @throws ValidationError 422 CANNOT_BLOCK_OWN_IP / IP_NOT_BLOCKABLE / INVALID_IP
 * @throws ConflictError 409 IP_ALREADY_BLOCKED (also for a parallel duplicate)
 */
export async function blockIp(
  rawIp: string,
  blockedBy: string,
  reason: string | undefined,
  requesterIp: string,
): Promise<{ id: string; ip: string; reason: string | null; blockedBy: string | null; createdAt: Date }> {
  const ip = normalizeIp(rawIp);
  if (!ip) {
    throw new ValidationError('Invalid IP address', 'INVALID_IP');
  }
  if (ip === normalizeIp(requesterIp)) {
    throw new ValidationError('You cannot block the address you are using', 'CANNOT_BLOCK_OWN_IP');
  }
  if (isPrivateOrReservedIp(ip)) {
    throw new ValidationError('Private and reserved addresses cannot be blocked', 'IP_NOT_BLOCKABLE');
  }

  // Write to DB (source of truth)
  const existing = await prisma.blockedIp.findUnique({ where: { ip } });
  if (existing) {
    throw new ConflictError('IP is already blocked', 'IP_ALREADY_BLOCKED');
  }

  let blocked;
  try {
    blocked = await prisma.blockedIp.create({
      data: { ip, blockedBy, reason: reason ?? null },
    });
  } catch (error) {
    // A parallel request blocked the same address between our check and insert.
    if (isPrismaUniqueViolation(error)) {
      throw new ConflictError('IP is already blocked', 'IP_ALREADY_BLOCKED');
    }
    throw error;
  }

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
 * @param rawIp - IP address to unblock, in any spelling (matched canonical)
 */
export async function unblockIp(rawIp: string): Promise<void> {
  const ip = normalizeIp(rawIp) ?? rawIp.trim();
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
 * Remove every automatic block whose end time has passed. getIpBlock removes
 * an expired entry only when that same IP comes back, so IPs that never return
 * would stay in the list forever. Called by the hourly cleanup job
 * (jobs/cleanup-expired-auth.job.ts). Fail-open: with Redis down it does
 * nothing and reports 0.
 *
 * @returns how many expired entries were removed
 */
export async function pruneExpiredAutoBlocks(nowSeconds: number = Date.now() / 1000): Promise<number> {
  try {
    return await getRedis().zremrangebyscore(AUTO_BLOCKED_KEY, '-inf', nowSeconds);
  } catch {
    logger.warn('[IP-BLOCK] Redis unavailable, expired automatic blocks not pruned this time');
    return 0;
  }
}

/**
 * List all currently blocked IPs (permanent from DB + active auto-blocks from Redis).
 */
export async function getBlockedIps(): Promise<{
  // blockedBy is null once the admin who created the block has been purged.
  permanent: { id: string; ip: string; reason: string | null; blockedBy: string | null; createdAt: Date }[];
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
  // Never auto-block infrastructure addresses (loopback / private / link-local /
  // Traefik-Docker internal). A shared proxy IP getting auto-blocked would lock
  // out every real user behind it. Public client IPs proceed as normal.
  if (isPrivateOrReservedIp(ip)) {
    return;
  }

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
