# create-tigra

`create-tigra` generates a full-stack TypeScript app that is ready for production on day one: a **Fastify 5** API
with **Prisma** (MySQL 8.4) and **Redis 7**, and a **Next.js 16** client. Sign-in and sessions, abuse protection,
uploads, an admin API, background jobs, health checks, tests, CI and Docker images for Coolify are already built,
tested and documented, so a new project starts at its own features instead of its plumbing.

The client ships the wiring, not the screens. Every app looks different, so you write the pages; the template gives
them the API client, the sign-in flow, the forms and the security headers they need.

```bash
npx create-tigra my-app
```

The CLI asks for a project name and whether new users must verify their email, then writes the project with fresh
secrets in its git-ignored `.env` files.

- [What you get](#what-you-get)
- [Quick start](#quick-start)
- [Everyday commands](#everyday-commands)
- [Testing and CI](#testing-and-ci)
- [Deploying to Coolify](#deploying-to-coolify)
- [Adding a module later](#adding-a-module-later)
- [Documentation](#documentation)
- [Upgrading from 3.x](#upgrading-from-3x)

## What you get

```text
my-app/
├── server/      Fastify 5 API: TypeScript, Prisma, MySQL 8.4, Redis 7, Vitest, Dockerfile
├── client/      Next.js 16 app: App Router, React 19, Tailwind v4, shadcn/ui, Vitest, Dockerfile
├── .github/     CI on every push, a weekly dependency audit, Dependabot
├── AGENTS.md    rules for AI coding agents (one more in server/ and client/), CLAUDE.md imports them
└── .agents/     the security-audit skill the agents use before they finish a change
```

How a request travels:

```text
Browser
  │   client/src/proxy.ts: a fresh CSP nonce per request, security headers,
  │   signed-out visitors sent away from protected pages
  ▼
Next.js client ── axios, httpOnly cookies ──▶ Fastify API  /api/v1/...
  one refresh per tab; a refresh race              │  CORS allowlist + origin check, real visitor IP,
  between tabs is replayed, not a sign-out         │  IP blocks, per-route rate limits, Zod input checks
                                                   ▼
                     route → controller → service → repository → Prisma → MySQL
                                                   │                Redis: rate limits, lockout, IP blocks
                                                   └─ background jobs · Resend email · health probes
```

### Server

| Area | What is built |
|---|---|
| Accounts and sign-in | Register, sign in, sign out, sign out everywhere, the list of your sessions, forgot and reset password by email. Tokens live in httpOnly cookies (access 15 min, refresh 7 days by default); passwords are hashed with Argon2id. |
| Sessions | Every refresh rotates the token. When two tabs refresh at once, exactly one wins and the other keeps its session. Tokens are stored only as SHA-256 fingerprints. Signing out, a password reset, a ban or an admin revoke ends the access token at once, not 15 minutes later. |
| Abuse protection | Rate limits per route and per IP, tuned from env (`RATE_LIMIT_MULTIPLIER`, `RATE_LIMIT_OVERRIDES`). A login lockout per email and IP (the 15th failure locks for 15 min, the 30th for 1 h) that a stranger cannot use against the real user. An automatic IP block for repeat offenders, a manual block list, and a per-address cap on emails anyone can trigger. Every "slow down" answer says how long to wait. |
| Real visitor address | Verified behind Cloudflare and Coolify's Traefik before it is believed, so nobody can pick their own rate-limit key or get someone else blocked. Check it any time at `GET /api/v1/admin/client-ip`. |
| Input and errors | Zod validates every input. Wrong input always answers `422 VALIDATION_FAILED` with the list of fields (never the submitted values); an unexpected error answers a generic 500 and is logged in full on the server. |
| Users and files | Profile, password change, account deletion (30 days to change your mind, then purged). Avatars are judged by their bytes (JPEG, PNG, WebP, HEIC, AVIF), stored as WebP with location data stripped, capped at 10 MB and 50 megapixels. Private files are served only to their owner. |
| Admin API | Stats, the user list (search, role, status, deleted accounts), user detail, ban and unban, role change, restoring a deleted account, the session list and revoke, IP blocks. An admin cannot ban themselves and the last admin cannot delete their account. The first admin is promoted with `make-admin`. |
| Outbound requests | One shared HTTP client with timeouts and redacted logs, plus `safeHttpClient` for URLs a user supplied: it refuses internal addresses (localhost, private networks, cloud metadata) on every redirect hop. |
| Email | Resend, with a 10 s timeout and masked addresses in the logs. Optional email verification for new users. |
| Background jobs | Run inside the server process, no extra service: expired sessions and tokens hourly, deleted accounts past 30 days daily, Cloudflare's IP list daily. Each first runs about a minute after the server starts, so frequent deploys never postpone them. |
| Health and logs | `/api/v1/live`, `/ready` and `/health` for probes, and the full report for admins at `/api/v1/admin/health`. One log line per request (JSON fields in production, never the query string) with passwords, tokens, cookies and keys redacted. A crash exits 1; shutdown finishes in-flight requests within 8 s. |
| Database and Redis | MySQL 8.4 with Prisma 6. New projects ship their first migration; production applies migrations at start and refuses to start without one. Production also refuses to start without Redis, because the limits, the lockout and the IP blocks depend on it. |
| Local infrastructure | Docker Compose for MySQL and Redis, reachable from your machine only; phpMyAdmin and Redis Commander when you ask for them. Each project gets its own ports, so several can run side by side. |

### Client

| Area | What is built |
|---|---|
| Framework | Next.js 16 (App Router, Server Components by default), React 19, TypeScript strict. |
| Security | `src/proxy.ts` (Next 16's name for middleware): a fresh CSP nonce per request with `strict-dynamic`, security headers, and a redirect to sign-in for protected pages. Tokens never reach JavaScript. |
| API client | Axios with httpOnly cookies. Parallel 401s share one refresh; a refresh race lost to another tab is replayed instead of signing out; a ban mid-session signs out at once; "slow down" answers show one toast with the wait time. |
| Sign-in wiring | `useAuth`, `useCurrentUser`, `AuthInitializer`, and the login, register and forgot-password form components: inline limit messages, the server's field errors under their fields, and a `?from=` redirect that only ever lands on your own site. Anonymous visitors make no API calls. |
| Admin wiring | Hooks and services for stats, users and sessions, ready for your own admin screens. |
| State | Redux Toolkit only for the signed-in user (one store per visitor), React Query for server data. |
| Design system | Tailwind CSS v4, shadcn/ui, OKLCH colour tokens with light and dark themes (next-themes). |
| Components | Header, footer, layouts, links with smooth navigation, a safe image, confirm dialog, empty state, pagination, loading states, error and not-found pages. |
| Testing | Vitest unit tests of the client's logic (session rules, the proxy, redirect safety, error parsing) with a coverage floor in CI. |

### Pages are yours

Besides a welcome page and the `/healthz` health check, the client ships no pages, on purpose. Add yours at the
paths in `client/src/lib/constants/routes.ts`; the proxy, the API client and the emails already send people there:

| Path | Your page | What to use |
|---|---|---|
| `/login` | sign in | `LoginForm` (reads `?from=`) |
| `/register` | sign up | `RegisterForm` |
| any path you like | forgot password | `ForgotPasswordForm` |
| `/reset-password?token=…` | new password, from the emailed link | `useResetPassword` |
| `/verify-account?token=…` | email verification (email module) | `useVerifyAccount`, `useSendVerification` |
| `/dashboard`, `/profile`, `/admin` and below | signed-in areas, protected by the proxy | `useCurrentUser`, the admin hooks |

The protected list lives next to the routes (`PROTECTED_PATHS`); add your own areas there.

### Built for AI agents

- `AGENTS.md` at the root and in `server/` and `client/`, with `CLAUDE.md` files that import them, so Codex and
  Claude Code read the same rules: the architecture, the sources of truth, safe migrations, deployment and tests.
- Cloudflare's MIT-licensed `security-audit` skill (`.agents/skills/`, with a pointer in `.claude/skills/`). Before
  finishing a meaningful change, the agent reviews the patch it is handing over (`git diff HEAD` plus new files):
  with the Codex Security plugin's diff scan when it is installed, otherwise with this skill. Full audits stay an
  explicit request.
- The code itself is the guide: one layout per module, one response and error shape, one rate-limit config, and a
  route-contract test that fails when a new route has no test.

## Quick start

Prerequisites:

- **Node.js 24+** with **npm 11.19+** for the generated apps (the CLI itself runs on Node 22.12+). Early Node 24
  releases ship an older npm 11 whose lockfiles the Docker images reject: check `npm -v`, update with
  `npm install -g npm@11`.
- **Docker**, for the local MySQL and Redis.

```bash
npx create-tigra my-app

# Server: infrastructure, database, API
cd my-app/server
npm ci                       # installs the shipped lockfile exactly
npm run docker:up            # MySQL and Redis for this project
npm run prisma:generate
npm run prisma:migrate:dev   # creates the tables from the shipped first migration
npm run dev                  # http://localhost:8000

# Client, in a second terminal
cd my-app/client
npm ci
npm run dev                  # http://localhost:3000
```

The CLI already wrote `server/.env` and `client/.env` with fresh secrets. Do not copy `.env.example` over them: the
server refuses the example's placeholder secret.

The database admin tools are off by default. `npm run docker:tools` starts phpMyAdmin and Redis Commander on the
ports the CLI printed (also in `server/docker-compose.yml`); `npm run docker:down` stops everything.

## Everyday commands

| In `server/` | What it does |
|---|---|
| `npm run dev` | API with reload on save |
| `npm test` / `npm run test:coverage` | unit tests (no database); with the coverage floor |
| `npm run test:integration` | every route against a real MySQL and Redis |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run build` / `npm start` | production build / run it |
| `npm run prisma:migrate:dev` | create and apply a migration after a schema change |
| `npm run prisma:studio` | browse the database |
| `npm run make-admin -- you@example.com` | promote an existing account to admin |
| `npm run docker:up` / `docker:tools` / `docker:down` | local MySQL and Redis / plus the admin UIs / stop |

| In `client/` | What it does |
|---|---|
| `npm run dev` | the app with fast refresh |
| `npm test` / `npm run test:coverage` | unit tests / with the coverage floor |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run build` / `npm start` | production build / run it locally (the Docker image runs the standalone `server.js`) |

## Testing and CI

```bash
cd my-app/server
npm test                  # unit tests: no database, no Docker
npm run test:coverage     # the same, failing below the coverage floor
npm run test:integration  # every route against a real MySQL + Redis

cd ../client
npm test                  # the client's logic: session rules, proxy, redirects, error parsing
npm run test:coverage
```

The integration tests start a throwaway MySQL and Redis with Testcontainers (Docker must run). To use services you
already run instead, set `INTEGRATION_DATABASE_URL` (a database whose name ends in `_test`) and
`INTEGRATION_REDIS_URL` (a Redis database from 1 to 15): the suite empties both first. Every route has a contract
test (who may call it, wrong input, success), and that file fails when a new route is never called. Details:
`server/docs/testing.md`.

New projects ship GitHub workflows in `.github/`:

- `ci.yml`, on every push and pull request: typecheck, lint, unit tests with coverage and build for both apps, and
  the server's integration tests (Testcontainers on GitHub's runners). It never deploys.
- `audit.yml`, weekly: `npm audit` of what production installs, red on a critical advisory. It does not block merges.
- `dependabot.yml`: security-update pull requests for npm packages and Actions (turn them on once in the
  repository's Settings → Advanced Security → Dependabot security updates), and a monthly pull request that
  refreshes the pinned `node:24-alpine` base image of both Dockerfiles (merge the two together).

## Deploying to Coolify

Server and client deploy as two separate Coolify applications, each from its own Dockerfile (`server/Dockerfile`,
`client/Dockerfile`).

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

```text
NEXT_PUBLIC_API_BASE_URL  (client)  https://api.example.com/api/v1     the API domain + /api/v1
CORS_ORIGIN               (server)  https://example.com                 the site's origin exactly: no path, no trailing slash
CLIENT_URL                (server)  https://example.com                 used in the links of emails
COOKIE_DOMAIN             (server)  .example.com                        when site and API are sibling subdomains; unset on one host
DATABASE_URL              (server)  mysql://…internal…/app?connection_limit=5
REDIS_URL                 (server)  redis://…internal…                  the internal URLs from Coolify's MySQL and Redis pages
```

A wrong database URL fails the deploy at its migration step, and production refuses to start when it cannot reach
Redis within 10 s. Either way the old container keeps serving.

Deploy the server first (it applies the migrations), then the client. Afterwards sign in as an admin and open
`/api/v1/admin/health`: every check should be up. Coolify switches traffic to a new container only once its Dockerfile
health check passes, so a container that cannot start keeps the old one serving. Migrations run while the old
container still serves; before one that drops or renames anything, read `server/docs/deployment.md` (in this repo:
[template/server/docs/deployment.md](template/server/docs/deployment.md)), which also explains why a build without
Docker's cache takes about 6 to 7 minutes longer (it compiles libvips).

**The server needs a persistent volume for uploads.** Avatars and other uploaded files are written to `/app/uploads`
inside the container, and every deploy starts a fresh container, so without a volume they are lost on each redeploy.
In the server application: **Storages → Add Volume Mount**, leave *Source Path* empty (Coolify manages the volume),
*Destination Path* `/app/uploads`. The server warns at boot (`[STORAGE] … is not on a mounted volume`) when it runs in
production without one.

**First admin.** Sign up in the app with the account that should be the admin (verify its email if the email module
is on). Then open the server application's **Terminal** in Coolify and run:

```bash
node dist/scripts/make-admin.js you@example.com
```

It only changes that account's role and marks its email verified: no password is asked for or printed. Locally:
`npm run make-admin -- you@example.com` in `server/`. The same command recovers a project whose last admin was
demoted or banned by mistake.

**Background jobs** run inside the server process, so no extra Coolify service is needed, and with more than one
server replica each runs them too, which is safe.

## Adding a module later

Modules add a feature to an existing project. Today there is one:

```bash
cd my-app                                 # the folder that holds server/ and client/
npx create-tigra add email-verification
```

It adds the verification routes (`POST /auth/send-verification`, `POST /auth/verify-account`), their integration
tests, the client's `useVerifyAccount` / `useSendVerification` hooks and service, and sets `REQUIRE_USER_VERIFICATION=true` in `server/.env`.
Then set `RESEND_API_KEY` in `server/.env` and restart the server. Answering "yes" to the email question when you
create a project does the same. Run it on projects made with 4.x: it copies tests that use the 4.x test helpers.

## Documentation

In every generated project:

| File | What it explains |
|---|---|
| `README.md`, `server/README.md`, `client/README.md` | what is where, how to run it |
| `server/docs/deployment.md` | what a deploy does, safe migrations (expand, deploy, contract), rollback, build time |
| `server/docs/rate-limits.md` | every limit, the login lockout, IP blocks, email caps, env overrides, Redis outages |
| `server/docs/testing.md` | unit and integration tests, writing new ones, CI, coverage |
| `server/docs/logging.md` | request logs, redaction, health checks |
| `server/.env.example`, `server/.env.example.production`, `client/.env.example*` | every setting, with notes |
| `AGENTS.md`, `server/AGENTS.md`, `client/AGENTS.md` | the rules agents (and people) follow when changing the code |

In this repository:

- [CHANGELOG.md](CHANGELOG.md): what changed in each release.
- [Client IP behind proxies and Cloudflare](docs/client-ip-behind-proxies.md): how the visitor address is verified,
  and how to port it to an older project.
- [Account ban vs email verification](docs/account-ban-vs-email-verification.md) and
  [Account deactivation and login](docs/account-deactivation-login-reactivation.md): two account-state fixes, with
  porting steps.
- [Rate limits](template/server/docs/rate-limits.md), [deployment](template/server/docs/deployment.md),
  [testing](template/server/docs/testing.md) and [logging](template/server/docs/logging.md): the same guides a
  generated project ships.

## Upgrading from 3.x

A generated project never updates itself: it is your code from the moment it is created. 4.0 changed most of the
template (sessions, rate limits, uploads, the admin API, jobs, health checks, tests, the Docker images, the agent
rules and the client). [CHANGELOG.md](CHANGELOG.md) lists every change by area; the guides in `docs/` show how to port
the ones that need care. New projects need Node 24 and npm 11.19+ (the 3.3.0 images ran Node 20).

## License

MIT
