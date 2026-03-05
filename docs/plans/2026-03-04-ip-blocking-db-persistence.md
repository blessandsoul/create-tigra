# IP Blocking: Database Persistence — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist admin-managed IP blocks to MySQL so they survive Redis restarts, using Redis as a hot cache for O(1) runtime lookups.

**Architecture:** DB is the source of truth for permanent blocks. On server boot, all blocked IPs are synced from DB to Redis. Admin block/unblock operations dual-write to both DB and Redis. Auto-blocks remain Redis-only (ephemeral). Runtime IP checks remain Redis-only (unchanged).

**Tech Stack:** Prisma (MySQL), ioredis, Fastify, Zod

**Target directory:** All changes in `template/server/` — do NOT modify `testapp/`.

---

### Task 1: Add BlockedIp model to Prisma schema

**Files:**
- Modify: `template/server/prisma/schema.prisma`

**Step 1: Add the BlockedIp model and User relation**

Add after the `Session` model at the end of `schema.prisma`:

```prisma
model BlockedIp {
  id        String   @id @default(uuid())
  ip        String   @unique @db.VarChar(45)
  reason    String?  @db.VarChar(500)
  blockedBy String

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [blockedBy], references: [id])

  @@index([ip])
  @@map("blocked_ips")
}
```

Add the reverse relation to the `User` model (after the `sessions` relation):

```prisma
  blockedIps    BlockedIp[]
```

**Step 2: Verify the schema is valid**

This is a template project — there is no live database. Just verify the schema file has no syntax errors by visual inspection (no `prisma validate` available without `DATABASE_URL`).

**Step 3: Commit**

```bash
git add template/server/prisma/schema.prisma
git commit -m "feat: add BlockedIp model to Prisma schema"
```

---

### Task 2: Update ip-block.ts with DB persistence + Redis sync

**Files:**
- Modify: `template/server/src/libs/ip-block.ts`

**Step 1: Rewrite ip-block.ts with dual-write and sync**

Replace the entire file with:

```typescript
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
export async function blockIp(ip: string, blockedBy: string, reason?: string): Promise<{ id: string; ip: string; reason: string | null; blockedBy: string; createdAt: Date }> {
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
```

**Step 2: Commit**

```bash
git add template/server/src/libs/ip-block.ts
git commit -m "feat: add DB persistence to IP blocking with Redis sync"
```

---

### Task 3: Update admin controller with userId and reason

**Files:**
- Modify: `template/server/src/modules/admin/admin.controller.ts`

**Step 1: Rewrite the controller**

Replace the entire file with:

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { successResponse } from '@shared/responses/successResponse.js';
import { ValidationError } from '@shared/errors/errors.js';
import { blockIp, unblockIp, getBlockedIps } from '@libs/ip-block.js';

const blockIpSchema = z.object({
  ip: z.union([z.ipv4(), z.ipv6()], { message: 'Invalid IP address' }),
  reason: z.string().max(500).optional(),
});

type BlockIpBody = z.infer<typeof blockIpSchema>;
type UnblockIpParams = { ip: string };

export async function listBlockedIps(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { permanent, autoBlocked } = await getBlockedIps();
  reply.send(successResponse('Blocked IPs retrieved', { permanent, autoBlocked }));
}

export async function blockIpHandler(
  request: FastifyRequest<{ Body: BlockIpBody }>,
  reply: FastifyReply,
): Promise<void> {
  const parsed = blockIpSchema.safeParse(request.body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid IP address', 'INVALID_IP');
  }

  const blocked = await blockIp(parsed.data.ip, request.user.id, parsed.data.reason);
  reply.status(201).send(successResponse('IP blocked successfully', blocked));
}

export async function unblockIpHandler(
  request: FastifyRequest<{ Params: UnblockIpParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { ip } = request.params;
  await unblockIp(ip);
  reply.send(successResponse('IP unblocked successfully', { ip }));
}
```

**Step 2: Commit**

```bash
git add template/server/src/modules/admin/admin.controller.ts
git commit -m "feat: pass userId and reason to IP block operations"
```

---

### Task 4: Add syncBlockedIpsToRedis to app startup

**Files:**
- Modify: `template/server/src/app.ts`

**Step 1: Update the import**

Change line 24 from:

```typescript
import { isIpBlocked, recordRateLimitViolation } from '@libs/ip-block.js';
```

to:

```typescript
import { isIpBlocked, recordRateLimitViolation, syncBlockedIpsToRedis } from '@libs/ip-block.js';
```

**Step 2: Add sync call before the IP block hook**

Add this line just before the `// --- IP Block Check` comment (before line 138):

```typescript
  // --- Sync permanent IP blocks from DB to Redis ---
  await syncBlockedIpsToRedis();
```

So it reads:

```typescript
  // --- Sync permanent IP blocks from DB to Redis ---
  await syncBlockedIpsToRedis();

  // --- IP Block Check (runs before everything else) ---
  app.addHook('onRequest', async (request: FastifyRequest) => {
    if (await isIpBlocked(request.ip)) {
      throw new ForbiddenError('Access denied', 'IP_BLOCKED');
    }
  });
```

**Step 3: Commit**

```bash
git add template/server/src/app.ts
git commit -m "feat: sync blocked IPs from DB to Redis on server startup"
```

---

### Task 5: Update Postman collection

**Files:**
- Modify: `template/server/postman/collection.json`

**Step 1: Update the "Block IP" request body**

Find the "Block IP" request (the POST to `blocked-ips`). Change the `raw` body from:

```json
"{\n  \"ip\": \"1.2.3.4\"\n}"
```

to:

```json
"{\n  \"ip\": \"1.2.3.4\",\n  \"reason\": \"Spam bot\"\n}"
```

**Step 2: Update the "Block IP" description**

Change from:

```
"Permanently block an IP address. Blocked IPs receive 403 IP_BLOCKED on all requests."
```

to:

```
"Permanently block an IP address. Persisted to database and cached in Redis. Blocked IPs receive 403 IP_BLOCKED on all requests. Optional reason field for audit trail."
```

**Step 3: Commit**

```bash
git add template/server/postman/collection.json
git commit -m "feat: update Postman collection with reason field for IP blocking"
```

---

### Task 6: Verify all changes are consistent

**Step 1: Review all modified files**

Verify the following are consistent:
- `blockIp()` signature in `ip-block.ts` matches the call in `admin.controller.ts`
- `syncBlockedIpsToRedis` is exported from `ip-block.ts` and imported in `app.ts`
- `BlockedIp` model in schema has `blockedBy` FK pointing to `User.id`
- `User` model has `blockedIps BlockedIp[]` reverse relation
- Postman body includes `reason` field
- `ConflictError` is imported in `ip-block.ts` (verify it exists in `@shared/errors/errors.js`)

**Step 2: Check that ConflictError exists**

Search for `ConflictError` in `template/server/src/shared/errors/`. If it doesn't exist, it needs to be added to the errors file.

**Step 3: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "chore: consistency fixes for IP blocking DB persistence"
```
