# Server Request Logging

## Overview

The server uses a single-line request/response logging system built on Pino, providing informative logs for every API request, color-coded in a development terminal.

## Log Format

Each completed request produces a single log line:

```
GET    /api/v1/auth/me 200 OK (12ms) [ip=203.0.113.7 reqId=<uuid>]
```

Format: `METHOD  URL  STATUS STATUS_MESSAGE  (DURATION) [ip=CLIENT_IP reqId=REQUEST_ID]`

`REQUEST_ID` is also sent back as the `x-request-id` response header. An inbound `X-Request-Id` (from a proxy in front) is kept only when it is at most 128 letters, digits, `.`, `_` or `-`; anything else gets a fresh UUID (`src/libs/request-id.ts`).

## Color Coding

Colors are added only when stdout is a terminal and `NODE_ENV` is not `production` (`shouldColorize()` in `src/libs/requestLogger.ts`). Production and container logs are plain text: escape codes would otherwise show up as `\u001b[34m` junk inside the JSON `msg` field.

### HTTP Methods (ANSI colors)
- **Blue**: GET (read operations)
- **Green**: POST (create operations)
- **Yellow**: PUT/PATCH (update operations)
- **Red**: DELETE (destroy operations)
- **Gray**: OPTIONS/HEAD (meta operations)

### Status Codes
- **Green**: 2xx (success)
- **Cyan**: 3xx (redirect)
- **Yellow**: 4xx (client error)
- **Red**: 5xx (server error)

## Log Levels by Status Code

| Status Range | Log Level | Example |
|---|---|---|
| 2xx | INFO | Successful requests |
| 4xx | WARN | Client errors (bad input, auth failures) |
| 5xx | ERROR | Server errors (unhandled exceptions) |

## Excluded Routes

Health check endpoints are excluded from logging to reduce noise:
- `/api/v1/health`
- `/api/v1/ready`
- `/api/v1/live`

## Health checks

Public, never rate limited or IP-blocked (`src/libs/health-routes.ts`):

| Route | Answer | Use |
|---|---|---|
| `GET /api/v1/health` | `{ status }`: `healthy` / `degraded` → 200, `unhealthy` → 503 | uptime monitors |
| `GET /api/v1/ready` | `{ ready, timestamp }`, 503 while the database is down | load balancers |
| `GET /api/v1/live` | `{ alive, timestamp }` | the Docker `HEALTHCHECK` |

`unhealthy` means the database is down. `degraded` means the database is slow (100 ms or more),
Redis is down or slow (so rate limits and IP blocks are off), or the heap is above 85% of its limit.

The public answer never says which check failed. Admins get the full report at
`GET /api/v1/admin/health`: per check status and timing, memory (heap used and limit, RSS),
uptime, `checkedAt`, `version` (from `package.json`) and `commit` (`SOURCE_COMMIT`, which
Coolify sets).

The database and Redis are checked at most once per 5 s; every probe in between gets the same
answer (`checkedAt` says when it was taken). A failing check logs the error at `error`
(database) or `warn` (Redis).

## Configuration

### Development
- Uses `pino-pretty` for colorized, human-readable logs
- Set `LOG_LEVEL=debug` in `.env` for verbose output

### Production
- Uses structured JSON logs (Pino default), with no color codes
- Optimized for log aggregation tools (ELK, CloudWatch, Datadog)
- Set `LOG_LEVEL=info` or `LOG_LEVEL=warn` in `.env`

## Performance Impact

- Minimal overhead (~1-2ms per request)
- Async logging prevents blocking the event loop
- Duration tracking uses `Date.now()` for low-overhead timing
