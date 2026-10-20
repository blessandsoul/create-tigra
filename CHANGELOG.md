# Changelog

A generated project never changes after it is created: these notes say what new projects get. To bring an older
project along, port the changes you need; the guides in [docs/](docs/) cover the ones that need care.

## 4.0.1 (2026-10-20)

Documentation only, no code changes.

- The README explains what create-tigra builds, area by area, how a request travels, the pages you add yourself,
  the everyday commands, `create-tigra add`, and where every guide lives.
- Generated projects get a root `README.md`, a `server/README.md` and a rewritten `client/README.md` (it was
  create-next-app's default text).
- `server/docs/testing.md` covers the client tests and the route-contract rule; `server/docs/logging.md` covers
  secret redaction.
- This changelog, now shipped in the npm package.
- The CLI fills the project's name, database and local ports into its new README.

## 4.0.0 (2026-10-20)

A full review of the template, area by area. Every change was tested on fresh projects with and without the
email-verification module, and the Docker images were built and run on Coolify.

### Breaking for new projects

- Generated apps need **Node 24 and npm 11.19+** (the 3.3.0 images ran Node 20). The images use `node:24-alpine`
  pinned by digest, and the tested lockfiles ship with every project and install with `npm ci`.
- Local and test MySQL is **8.4**.
- In production the server refuses to start without any migration, without `REDIS_URL`, or when Redis cannot be
  reached within 10 s of starting.
- `TRUST_CLOUDFLARE`, `DATABASE_POOL_MIN` and `DATABASE_POOL_MAX` are gone; `CLOUDFLARE_ORIGIN_SECRET` is new.
- Wrong input always answers `422 VALIDATION_FAILED` with the list of fields.
- The public `/api/v1/health` answers only its status; the full report moved to `GET /api/v1/admin/health`.
- Client: `src/middleware.ts` is now `src/proxy.ts` (Next 16's name), and the Redux store is created per visitor
  with `makeStore()` instead of being one exported `store`.
- `create-tigra add email-verification` is meant for 4.x projects: it copies tests that use the 4.x test helpers.

### Generator

- New projects ship their first migration (`0_init`); a check keeps it equal to the schema.
- The README no longer tells you to copy `.env.example` over the `.env` that holds the generated secrets.
- The CLI warns when Node is older than 24 or npm older than 11.19.

### Foundation and configuration

- `REDIS_URL` is required in production; on/off switches accept only `true` or `false`.
- `CLIENT_URL` is required in production only when emails can go out.
- Email verification is off unless the email module is installed.
- The production example uses `PORT=8000` and caps the database pool (`?connection_limit=5`).

### Request pipeline

- The client IP is verified before it is believed: behind Cloudflare, behind Coolify's Traefik, or direct
  ([guide](docs/client-ip-behind-proxies.md)).
- Rate limits for public use: clear wait times (`retryAfterSeconds`), a per-address email cap, overrides through
  env (`RATE_LIMIT_OVERRIDES`, `RATE_LIMIT_MULTIPLIER`); token flows answer a clear 503 while Redis is down.
- `CORS_ORIGIN` is checked at boot (bare origins only, with the fix printed).
- Auth cookies are never `SameSite=None`: the tokens are Strict and the session marker is Lax, so a link from
  another site no longer bounces a signed-in user to `/login`.
- A warning when production runs on plain http (the browser would drop the login cookies).
- Log redaction covers secrets at every level it promises; an inbound `X-Request-Id` is kept only when short and
  plain.

### Sessions and accounts

- Two tabs refreshing at once: exactly one wins and the other keeps its session.
- Refresh, reset and verification tokens are stored as SHA-256 fingerprints only.
- Signing out, signing out everywhere, a password reset and an admin revoke end the access token at once; a banned
  user's token answers `403 ACCOUNT_DEACTIVATED` at once.
- A password-reset link works once, even when used twice at the same moment.
- A wrong password on change-password or delete-account answers 422, not 401; changing your own password keeps
  this device signed in.
- Strangers can no longer use up a user's verification emails.

### Users and files

- Multipart fields are capped, so one upload cannot hold about 1 GB of memory; a file cut at the size limit
  answers 413.
- Avatar formats are judged by their bytes (JPEG, PNG, WebP, HEIC, AVIF); HEIC is proven to decode in the image
  build. Every avatar gets a new file name, and the old file goes only after the swap.
- A deleted account's photo stops being public at once; names are trimmed before their length is checked.
- The server warns at boot when uploads are not on a persistent volume.

### Admin API

- An admin cannot ban themselves, and the last admin cannot delete their own account.
- IP blocks use one canonical spelling, match however they were written, and cannot block an admin's own or a
  private address.
- Deleted accounts can be listed and restored during their 30 days.
- `make-admin` promotes an existing account to admin (the first admin, or recovery).
- User detail says `lastActiveAt`; the user list's filters work again.

### Background jobs

- Jobs run about a minute after every start, then on their schedule, so frequent deploys never postpone them
  (before, an app deployed at least daily never purged deleted accounts).
- Expired automatic IP blocks are pruned hourly; an account another process already purged is not a failure.

### Outbound requests and email

- `safeHttpClient` for URLs a user supplied: it refuses internal addresses on every redirect hop. The
  internal-address check no longer misses hex IPv4-mapped forms.
- Outbound URLs are logged redacted; failures carry their status and kind.
- Sending email gives up after 10 s, and recipients are logged masked. Production refuses the placeholder Resend
  key and sender.

### Health, logs and shutdown

- Memory is judged against the heap limit; a failing check logs the real error.
- The database and Redis are checked at most once per 5 s for all probes together.
- Request lines carry JSON fields in production and never keep the query string.
- Crashes and failed starts exit 1, and shutdown has an 8 s deadline (inside Docker's 10 s).

### Testing and CI

- The critical advisories in the shipped dependencies are cleared.
- Integration tests ship with every project (166, or 172 with the email module): every route's contract, plus identity, users, admin, jobs, health
  and email behaviour, against a real MySQL and Redis (Testcontainers, or services you already run). The route
  contract fails when a new route is never called.
- An honest coverage floor counts every file, on the server and now on the client.
- The server's lint refuses unawaited and misused promises.
- New projects ship CI, a weekly audit of production dependencies and Dependabot (security updates for npm and
  Actions, monthly base-image updates).

### Deployment

- The images run on any x86-64 CPU: sharp is built on a pinned libvips, so VPSes without x86-64-v2 work.
- curl health checks; plain (uncoloured) production logs.
- The client image build stops when `NEXT_PUBLIC_API_BASE_URL` is missing; the client health check is `/healthz`,
  which works even when the home page redirects.
- A Coolify checklist in the README and `server/docs/deployment.md`: what a deploy does, safe migrations (expand,
  deploy, contract), rollback, and the libvips build time.

### Guidance for AI agents

- The completion check reviews the patch actually handed over (`git diff HEAD` plus new files). Claude Code's
  `/security-review` is not that check: it only sees commits.
- The root `AGENTS.md` tells Codex to read the server and client files, which it does not load by itself.
- The agent files now carry the migration, job, deployment and test rules, and the security workflow covers the
  client's security code.

### Client

- A Vitest unit suite (session rules, the proxy, redirect safety, error parsing) runs in CI with a coverage floor.
- A refresh race lost to another tab is replayed instead of signing out; a ban mid-session signs out at once.
- Anonymous visitors make no API calls (it was two failing calls per page view).
- Protected paths match whole segments (`/administrator` is no longer treated as `/admin`).
- The server's field errors show under their fields; the register rules mirror the server's.
- The header is right on the first render, and hydration uses the server's state (a second tab could hit a
  hydration mismatch).
- The welcome page links to this repository.
