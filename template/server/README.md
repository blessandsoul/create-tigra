# Server

The API: Fastify 5 and TypeScript, Prisma 6 on MySQL 8.4, Redis 7 (ioredis), Zod, Pino, Vitest. Every route lives
under `/api/v1`.

## Layout

```text
server/
├── src/
│   ├── app.ts              builds the app: plugins, security hooks, routes
│   ├── server.ts           starts it: database, Redis, jobs, graceful shutdown
│   ├── config/             env.ts (every setting, validated at boot), rate-limit.config.ts (every limit)
│   ├── modules/<domain>/   auth, users, admin, files: routes → controller → service → repo (+ schemas)
│   ├── libs/               shared pieces: auth, cookies, client IP, rate limiting, IP blocks, email,
│   │                       HTTP clients, storage, logging, health, shutdown, validation errors
│   ├── jobs/               background jobs and their scheduler
│   ├── scripts/            make-admin
│   ├── shared/             response helpers, error classes, shared types
│   └── test/               integration test setup and helpers
├── prisma/                 schema.prisma and migrations/ (starting with 0_init)
├── docs/                   deployment, rate limits, testing, logging
├── postman/                a collection of every route
├── uploads/                local uploads (a volume at /app/uploads in production)
├── docker-compose.yml      local MySQL and Redis (+ phpMyAdmin and Redis Commander with --profile tools)
└── Dockerfile              the production image
```

## Commands

```bash
npm run dev                  # the API with reload, on PORT (8000)
npm test                     # unit tests, no database
npm run test:coverage        # unit tests with the coverage floor (vitest.config.ts)
npm run test:integration     # every route against a real MySQL and Redis (docs/testing.md)
npm run lint && npm run typecheck
npm run build && npm start   # production build, then run it

npm run prisma:migrate:dev   # after changing schema.prisma: create and apply a migration
npm run prisma:studio        # browse the database
npm run make-admin -- you@example.com
npm run docker:up | docker:tools | docker:down
```

## Routes

| Route | Who may call it |
|---|---|
| `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` | anyone |
| `POST /auth/forgot-password`, `/auth/reset-password` | anyone (the emailed link carries the token) |
| `GET /auth/me`, `GET /auth/sessions`, `POST /auth/logout-all` | signed in |
| `PATCH /users/me`, `PATCH /users/me/password`, `DELETE /users/me` | signed in |
| `POST /users/avatar`, `DELETE /users/avatar` | signed in |
| `PATCH /users/:userId`, `/users/:userId/password`, `DELETE /users/:userId`, `POST` and `DELETE /users/:userId/avatar` | the owner, or an admin |
| `GET /files/:filename` | the file's owner |
| `GET /admin/stats`, `/admin/health`, `/admin/client-ip` | admin |
| `GET /admin/users`, `GET /admin/users/:userId`, `PATCH /admin/users/:userId/status` and `/role`, `POST /admin/users/:userId/restore` | admin |
| `GET /admin/sessions`, `DELETE /admin/sessions/:sessionId` | admin |
| `GET /admin/blocked-ips`, `POST /admin/blocked-ips`, `DELETE /admin/blocked-ips/:ip` | admin |
| `GET /health`, `/ready`, `/live` | anyone (never rate limited) |

With the email-verification module: `POST /auth/send-verification` and `POST /auth/verify-account`. Public avatars are
served from `/uploads/`. `postman/collection.json` has every route with example bodies.

Every answer has one shape:

```json
{ "success": true, "message": "Profile updated", "data": { } }
{ "success": false, "error": { "code": "VALIDATION_FAILED", "message": "Please check these fields: email", "fields": [{ "field": "email", "message": "Invalid email address" }] } }
```

Wrong input is always `422 VALIDATION_FAILED` with `fields`; "slow down" answers (429, and 403 `IP_BLOCKED`) carry
`retryAfterSeconds`; an unexpected error is a generic 500, logged in full here.

## Adding a feature

1. A module in `src/modules/<domain>/`: `<domain>.routes.ts` (paths and Zod schemas), `.controller.ts` (HTTP in and
   out), `.service.ts` (business rules and who may do what), `.repo.ts` (Prisma queries only), `.schemas.ts`.
2. Register its routes in `src/app.ts` under the `/api/v1` prefix. A new route gets the default limit of 200 per
   minute; give it a `RATE_LIMITS` entry in `src/config/rate-limit.config.ts` only when it needs another number.
3. A schema change: edit `prisma/schema.prisma`, then `npm run prisma:migrate:dev`. Migrations run while the old
   version still serves, so never drop, rename, retype or tighten a column in the same deploy as the code that
   stops using it (`docs/deployment.md`).
4. Tests: unit tests next to the code (`__tests__/`), and the route's contract (401/403, 422, success) in
   `src/__tests__/routes.integration.test.ts`. That file fails when a registered route is never called.
5. Fetching a URL a user gave you: `safeHttpClient` (`src/libs/safe-http.ts`), never `fetch`. Recurring work:
   `startRecurringJob` (`src/jobs/schedule.ts`), never `setInterval`.

`AGENTS.md` in this folder has the full set of rules.

## Configuration

`src/config/env.ts` validates every setting at boot and stops with the reason when one is wrong. `.env.example`
documents development, `.env.example.production` documents production. In production the server also refuses to
start:

- with a placeholder `JWT_SECRET`, or a `CORS_ORIGIN` that is not a list of bare origins;
- without `REDIS_URL`, or when Redis is not reachable within 10 s (the limits, the lockout and the IP blocks would
  be off);
- without any migration in the image;
- with the placeholder Resend key or sender, when email is set up.

## Guides

- `docs/deployment.md`: what a deploy does, safe migrations, rollback, build time.
- `docs/rate-limits.md`: every limit, the login lockout, IP blocks, email caps, overrides, Redis outages.
- `docs/testing.md`: the unit and integration suites, writing tests, CI, coverage.
- `docs/logging.md`: request logs, redaction, health checks.
