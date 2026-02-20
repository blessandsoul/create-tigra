# Server Request Logging

## Overview

The server uses a single-line request/response logging system built on Pino, providing color-coded, informative logs for every API request.

## Log Format

Each completed request produces a single log line:

```
GET    /api/v1/auth/me 200 OK (12ms)
```

Format: `METHOD  URL  STATUS STATUS_MESSAGE  (DURATION)`

## Color Coding

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

## Configuration

### Development
- Uses `pino-pretty` for colorized, human-readable logs
- Set `LOG_LEVEL=debug` in `.env` for verbose output

### Production
- Uses structured JSON logs (Pino default)
- Optimized for log aggregation tools (ELK, CloudWatch, Datadog)
- Set `LOG_LEVEL=info` or `LOG_LEVEL=warn` in `.env`

## Performance Impact

- Minimal overhead (~1-2ms per request)
- Async logging prevents blocking the event loop
- Duration tracking uses `Date.now()` for low-overhead timing
