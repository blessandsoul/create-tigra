# create-tigra

Scaffold a production-ready full-stack application with **Next.js 16** + **Fastify 5** + **Prisma** + **Redis**.

## Quick Start

```bash
npx create-tigra my-app
```

## What's Included

### Client (Next.js 16)

| Feature | Technology |
|---|---|
| Framework | Next.js 16 (App Router, React 19) |
| Styling | Tailwind CSS v4, shadcn/ui, OKLCH color system |
| State | Redux Toolkit (auth), React Query v5 (server data) |
| Forms | React Hook Form + Zod validation |
| HTTP | Axios with httpOnly cookie auth + auto refresh |
| Auth UI | Login, register and forgot-password form components (no pages: add your own `/login` and `/register` pages. The proxy, `src/proxy.ts`, sends signed-out visitors of `/dashboard`, `/profile` and `/admin` to `/login`) |
| Components | Header, Footer, Loading, Error, Empty states |
| Theme | Light/Dark mode with next-themes |
| Testing | Vitest unit tests of the client's logic: the API client's session rules (refresh, a lost refresh race between tabs, a ban mid-session), the proxy's CSP and redirects, redirect safety, error and field-error parsing; a coverage floor in CI |

### Server (Fastify 5)

| Feature | Technology |
|---|---|
| Framework | Fastify 5 with TypeScript (strict) |
| Database | MySQL 8.4 + Prisma 6 ORM |
| Cache | Redis 7 (ioredis) |
| Auth | JWT (httpOnly cookies), session management |
| Validation | Zod schemas on all inputs |
| Security | Helmet, CORS, rate limiting (per route, per IP, set through ENV), login lockout, IP auto-block, password hashing (Argon2). If Redis goes down, the limits, lockout and blocks are off until it is back |
| File uploads | Multipart + Sharp image optimization |
| Logging | Pino with pretty dev output |
| Testing | Vitest: unit tests (no database needed) and integration tests of every route against a real MySQL and Redis (Testcontainers, or services you already run); a coverage ratchet; CI, a weekly dependency audit and Dependabot security updates for GitHub included |
| Dev tools | Docker Compose (MySQL, phpMyAdmin, Redis, Redis Commander) |
| Production images | Node 24 Alpine Dockerfiles (server and client) with sharp built on a pinned libvips, so they run on any x86-64 CPU, including VPSes without x86-64-v2, plus curl for Coolify's health check |

### Codex Development

Includes concise `AGENTS.md` guidance at the project root and scoped guidance inside `client/` and `server/`, with matching `CLAUDE.md` files that import them so Claude Code reads the same rules. Generated projects also include Cloudflare's MIT-licensed `security-audit` repository skill (in `.agents/skills/` for Codex, with a thin pointer in `.claude/skills/` for Claude Code). Meaningful server changes must use its focused guidance and, before completion, scan the working-tree patch: `security-diff-scan` when the Codex Security plugin is installed, or `/security-review` in Claude Code.

The security workflow falls back to the bundled skill when Codex Security is unavailable, while full or deep repository audits remain explicit operations rather than an automatic cost on every edit.

## Prerequisites

- **Node.js** 24+ with **npm** 11.19+ for the generated apps (the CLI itself runs on Node 22.12+). Early Node 24 releases ship an older npm 11 whose lockfiles the Docker images reject; check `npm -v` and update with `npm install -g npm@11`.
- **Docker** (for MySQL and Redis)

## After Scaffolding

```bash
# 1. Start infrastructure
cd my-app/server
docker compose up -d

# 2. Install server dependencies & set up database
#    (npm ci installs the shipped package-lock.json exactly, without rewriting it;
#    the CLI already wrote server/.env and client/.env with fresh secrets, so do
#    not copy .env.example over them: the server refuses its placeholder secret)
npm ci
npm run prisma:generate
npm run prisma:migrate:dev   # creates the tables from the shipped 0_init migration

# 3. Start the server
npm run dev

# 4. In a new terminal, set up the client
cd my-app/client
npm ci
npm run dev
```

- Server: http://localhost:8000
- Client: http://localhost:3000
- phpMyAdmin and Redis Commander (optional, see below): each project gets its own ports, so several projects can run side by side. The CLI prints them when it finishes; they are also in `server/docker-compose.yml`.

The admin UIs (phpMyAdmin, Redis Commander) are behind the docker-compose `tools` profile and do **not** start with plain `docker compose up -d`. Start them with:

```bash
cd my-app/server
docker compose --profile tools up -d
```

## Testing and CI

```bash
cd my-app/server
npm test                  # unit tests: no database, no Docker
npm run test:coverage     # the same, with the coverage ratchet (vitest.config.ts)
npm run test:integration  # every route against a real MySQL + Redis
```

The integration tests start a throwaway MySQL and Redis with Testcontainers (Docker must run). To use services you
already run instead, set `INTEGRATION_DATABASE_URL` (a database whose name ends in `_test`) and
`INTEGRATION_REDIS_URL` (a Redis database 1-15): the suite empties both first. Details and how to write new tests:
`server/docs/testing.md`.

New projects ship with GitHub workflows in `.github/`:
- `ci.yml`, on every push and pull request: typecheck, lint, unit tests with coverage, the server build, the
  integration tests (Testcontainers on GitHub's runners) and the client build. It never deploys.
- `audit.yml`, weekly: `npm audit` of what production installs, red on a critical advisory. It does not block merges.
- `dependabot.yml`: security-update pull requests for npm packages and Actions (turn them on once in the
  repository's Settings → Advanced Security → Dependabot security updates), and a monthly pull request that
  refreshes the pinned `node:24-alpine` base image of both Dockerfiles (merge the two together).

## Deploying to Coolify

Server and client deploy as two separate Coolify applications, each from its own Dockerfile (`server/Dockerfile`, `client/Dockerfile`).

**Coolify checklist.** One Coolify project with two applications (from the same Git repository), a MySQL and a Redis:

| Setting | Server application | Client application |
|---|---|---|
| Build Pack | Dockerfile | Dockerfile |
| Base Directory | `/server` | `/client` |
| Ports Exposes | `8000` | `3000` |
| Domain | your API domain, e.g. `https://api.example.com` | your site, e.g. `https://example.com` |
| Health check | nothing to set: Coolify uses the Dockerfile's (`/api/v1/live`) | nothing to set: the Dockerfile's (`/healthz`) |
| Environment variables | from `server/.env.example.production`, runtime only: never tick "Available at Buildtime" | `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_APP_NAME` with "Available at Buildtime" ticked: the build stops without the API address |
| Storage | a volume at `/app/uploads` (below) | none |

How the domains map to the variables:
- `NEXT_PUBLIC_API_BASE_URL` (client) = the API domain + `/api/v1`, e.g. `https://api.example.com/api/v1`.
- `CORS_ORIGIN` (server) = the site's origin exactly, e.g. `https://example.com` (no path, no trailing slash).
- `CLIENT_URL` (server) = the site's address, used in the links of emails.
- `COOKIE_DOMAIN` (server) = `.example.com` when site and API are sibling subdomains; unset when they share one host.
- `DATABASE_URL` and `REDIS_URL` (server) = the internal URLs shown on the MySQL and Redis pages in Coolify, with
  `?connection_limit=5` on the database URL. A wrong database URL fails the deploy at its migration step, and
  production refuses to start when it cannot reach Redis within 10 s.

Deploy the server first (it applies the migrations), then the client. Afterwards sign in as an admin and open
`/api/v1/admin/health`: every check should be up. Coolify switches traffic to a new container only once its Dockerfile
health check passes, so a container that cannot start keeps the old one serving. Migrations run while the old
container still serves; before one that drops or renames anything, read `server/docs/deployment.md` (in this repo:
[template/server/docs/deployment.md](template/server/docs/deployment.md)), which also explains why a build without
Docker's cache takes about 6 to 7 minutes longer (it compiles libvips).

**The server needs a persistent volume for uploads.** Avatars (and any other uploaded files) are written to `/app/uploads` inside the container, and every deploy starts a fresh container. Without a volume, all uploaded files are lost on each redeploy. In the server application: **Storages → Add Volume Mount**, leave *Source Path* empty (Coolify manages the volume), *Destination Path* `/app/uploads`. The server warns at boot (`[STORAGE] … is not on a mounted volume`) when it runs in production without one. Details: `server/.env.example.production`, section FILE UPLOAD.

**First admin.** Sign up in the app with the account that should be the admin (your own password; verify the email if the email module is on). Then open the server application's **Terminal** in Coolify and run `node dist/scripts/make-admin.js you@example.com`. It only changes that account's role and marks its email verified: no password is asked for or printed. Locally: `cd server && npm run make-admin -- you@example.com`. The same command recovers a project whose last admin was demoted or banned by mistake.

**Background jobs** run inside the server process, so no extra Coolify service is needed. Each first runs about a minute after the server starts, then on its own schedule:
- expired sessions and tokens: hourly;
- deleted accounts past their 30 days: daily;
- Cloudflare's IP list: daily.

A deploy never postpones them. With more than one server replica, each runs them too, which is safe.

## Security and Migration Notes

- [Account deactivation login reactivation: issue, fix, and existing-project migration](docs/account-deactivation-login-reactivation.md)
- [Client IP behind proxies and Cloudflare: how the visitor address is verified, and existing-project porting](docs/client-ip-behind-proxies.md)
- [Rate limits, login lockout, email cap and IP blocks: every limit, ENV overrides, Redis-down behaviour, and existing-project porting](template/server/docs/rate-limits.md)

## License

MIT
