# IP Blocking: Database Persistence

## Problem

Blocked IPs are stored only in Redis. If Redis restarts, all permanent blocks are lost. Admin-managed blocks need durable storage.

## Decision

- **DB = source of truth** for permanent (admin-managed) blocks
- **Redis = hot cache** for runtime O(1) lookups
- **Auto-blocks stay Redis-only** (ephemeral, 1-hour TTL, self-healing)

## Architecture

```
Admin blocks IP   → Write to DB + Redis SET (dual write)
Admin unblocks IP → Delete from DB + Redis SET (dual write)
Server boots      → Load all blocked IPs from DB into Redis SET
Runtime check     → Redis only (O(1), fail-open, unchanged)
Auto-blocks       → Redis only (unchanged)
```

## Database Schema

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

## API Changes

**POST /api/v1/admin/blocked-ips** adds optional `reason`:
```json
{ "ip": "1.2.3.4", "reason": "Spam bot" }
```

**GET /api/v1/admin/blocked-ips** permanent blocks now include metadata:
```json
{
  "permanent": [
    { "id": "uuid", "ip": "1.2.3.4", "reason": "Spam bot", "blockedBy": "admin-uuid", "createdAt": "..." }
  ],
  "autoBlocked": ["5.6.7.8"]
}
```

## Files Changed

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `BlockedIp` model + relation on `User` |
| `src/libs/ip-block.ts` | Add `syncBlockedIpsToRedis()`, dual-write block/unblock, DB-backed list |
| `src/modules/admin/admin.controller.ts` | Pass `userId` + `reason`, update schemas |
| `src/app.ts` | Call `syncBlockedIpsToRedis()` on startup |
| `postman/collection.json` | Update block request body |

## What stays the same

- Runtime IP check flow (Redis O(1), fail-open)
- Auto-blocks (Redis ZSET, ephemeral)
- Rate limit violation tracking
- All existing endpoints and their paths
