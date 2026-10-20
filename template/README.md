# {{PROJECT_DISPLAY_NAME}}

A full-stack TypeScript app generated with [create-tigra](https://github.com/blessandsoul/create-tigra): a Fastify
API and a Next.js client that run and deploy separately.

```text
{{PROJECT_NAME}}/
├── server/      the API: Fastify 5, Prisma (MySQL 8.4), Redis 7        → server/README.md
├── client/      the web app: Next.js 16, React 19, Tailwind v4         → client/README.md
├── .github/     CI on every push, a weekly dependency audit, Dependabot
└── AGENTS.md    the rules for changing this code (AI agents read it; so can you)
```

## Run it locally

You need Node.js 24+ with npm 11.19+ (`npm -v`), and Docker for MySQL and Redis.

```bash
cd server
npm ci                       # the shipped lockfile, exactly
npm run docker:up            # this project's MySQL and Redis
npm run prisma:generate
npm run prisma:migrate:dev   # creates the tables from the first migration
npm run dev

# second terminal
cd client
npm ci
npm run dev
```

| What | Where |
|---|---|
| Web app | http://localhost:3000 |
| API | http://localhost:8000/api/v1 (health: `/api/v1/health`) |
| MySQL | `127.0.0.1:{{MYSQL_PORT}}`, database `{{DATABASE_NAME}}` |
| Redis | `127.0.0.1:{{REDIS_PORT}}` |
| phpMyAdmin / Redis Commander | http://localhost:{{PHPMYADMIN_PORT}} / http://localhost:{{REDIS_COMMANDER_PORT}}, after `npm run docker:tools` |

`server/.env` and `client/.env` were written with fresh secrets when the project was created; they are git-ignored.
Every setting is explained in `server/.env.example` and `client/.env.example`.

## Before you build features

- **The client has no pages yet, on purpose.** It ships the wiring (API client, sign-in flow, forms, security
  headers) and you design the screens. Add pages at the paths in `client/src/lib/constants/routes.ts`: `/login`,
  `/register`, `/reset-password`, `/dashboard`, `/profile`, `/admin`. The proxy and the emails already send people
  there. See `client/README.md`.
- **The first admin:** sign up, then `npm run make-admin -- you@example.com` in `server/` (in production:
  `node dist/scripts/make-admin.js you@example.com` in the server's terminal).
- **Emails** (password reset, and verification if it is on) need `RESEND_API_KEY` in `server/.env`.

## Before you push

```bash
cd server && npm run lint && npm run typecheck && npm run test:coverage && npm run test:integration && npm run build
cd client && npm run lint && npm run typecheck && npm run test:coverage && npm run build
```

CI (`.github/workflows/ci.yml`) runs the same on every push and pull request. The integration tests need Docker, or a
MySQL and Redis you already run (`server/docs/testing.md`).

## Deploy

Two Coolify applications from this repository, one per Dockerfile (`server/`, `client/`), plus a MySQL and a Redis.
Deploy the server first: it applies the migrations at start. The settings, the variables and what a deploy does:
`server/docs/deployment.md`, and the checklist in the
[create-tigra README](https://github.com/blessandsoul/create-tigra#deploying-to-coolify).

## Guides

| File | What it explains |
|---|---|
| `server/README.md`, `client/README.md` | each app's layout, commands and conventions |
| `server/docs/deployment.md` | what a deploy does, safe migrations, rollback |
| `server/docs/rate-limits.md` | rate limits, login lockout, IP blocks, email caps |
| `server/docs/testing.md` | unit and integration tests, CI, coverage |
| `server/docs/logging.md` | request logs, redaction, health checks |
| `AGENTS.md`, `server/AGENTS.md`, `client/AGENTS.md` | the rules for changing the code |
