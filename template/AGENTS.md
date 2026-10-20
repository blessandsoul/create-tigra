# Agent instructions

**Read the scoped file first.** Before changing anything in `server/`, read `server/AGENTS.md`; before changing anything in `client/`, read `client/AGENTS.md`. Claude Code loads them by itself when it opens files there. Codex does not: it loads only the AGENTS.md files from the project root down to the folder it was started in, so started here it never sees them.

## MUST FOLLOW — comment important code

Every implementation change MUST include a human-readability pass. Add or update concise comments or doc comments for important functionality and for non-obvious contracts, invariants, edge cases, business rules, security boundaries, deployment constraints, performance choices, and workarounds. Explain why and what must remain true; do not narrate obvious syntax. Keep comments accurate and remove stale ones.

<!-- project-facts:start -->
## Project facts

> Maintained by the `seed-project-facts` skill: run it once to fill the TODOs. This section is the source of truth for this project: keep it true. If your work changes any line (deployment, URLs, hosting, databases, Redis, integrations, rules), update it and the seed-plugins registry row in the same change. If it conflicts with reality, trust reality, fix it, and tell Tornike. No secrets here.

- **Name:** {{PROJECT_NAME}}
- **Purpose:** TODO
- **Production:** TODO (client URL / server URL, or "not deployed")
- **Hosting:** TODO (Coolify instance, or none)
- **Local MySQL:** `{{DATABASE_NAME}}` on TODO (central-mysql | per-project container)
- **Production MySQL:** TODO (`db` on shared MySQL on <instance> | dedicated Coolify MySQL | none)
- **Redis:** TODO (local yes/no / production yes/no)
- **Talks to:** TODO
- **Special rules:** none
<!-- project-facts:end -->

## Architecture and sources of truth

- `client/` is a Next.js App Router application; `server/` is a Fastify API backed by Prisma/MySQL and Redis. They deploy independently.
- The server owns authorization, business rules, and security validation. Client validation exists for UX and is never a trust boundary.
- `server/prisma/schema.prisma` is the database-schema source of truth. Use Prisma migrations for schema changes.
- `server/src/config/env.ts` and `client/src/lib/env.ts` define valid environment variables. Keep the corresponding `.env.example` files synchronized without real credentials.
- Shared route/API constants, response helpers, and security middleware are canonical; extend them instead of creating competing shapes or duplicate policy.
- Client font preset tokens are declared on `:root`. Apply every referenced `next/font` variable class to `<html>`, never only to `<body>`, so the root-scoped Tailwind tokens can resolve it.

## Naming

- Use functional kebab-case for project names and anything surfaced in CLIs, logs, queues, jobs, or worker/process names.
- Use camelCase for TypeScript values/functions, PascalCase for components/types/classes, and UPPER_SNAKE_CASE for true constants.
- Keep domain folders and route paths lowercase and functional; the file naming rules of each app are in `server/AGENTS.md` and `client/AGENTS.md`.

## Deployment boundaries

- The Dockerfile in each app is its production contract. Re-check it when changing ports, entry points, build output, native dependencies, runtime files, health routes, or environment variables.
- The client must retain Next.js `output: "standalone"`; every `NEXT_PUBLIC_*` value is public and must be available at Docker build time. The client build stops when `NEXT_PUBLIC_API_BASE_URL` is empty. Its health check is `GET /healthz` (`client/src/app/healthz/route.ts`), which must keep answering 200 without rendering a page.
- The server container applies `prisma migrate deploy` before startup and exposes unauthenticated `GET /api/v1/live` for orchestration. It refuses to start when the image has no migrations (the database would have no tables), so keep `server/prisma/migrations/` committed, starting with the shipped `0_init`, and never switch to `prisma db push` for production. In production it also refuses to start when Redis is not reachable within 10 s: rate limits, login lockout and IP blocks run on Redis.
- Every deploy applies the new migrations while the old version is still serving, so a migration must work with the code that is still running. Follow expand / deploy / contract (`server/docs/deployment.md`): never drop, rename, retype or make a column required in the same deploy as the code that stops using it.
- Both Dockerfiles build sharp against a pinned libvips so images run on CPUs without x86-64-v2. When upgrading sharp (or Next, which brings its own sharp), check the new sharp's `config.libvips` range; if `LIBVIPS_VERSION` no longer satisfies it, bump `LIBVIPS_VERSION` and `LIBVIPS_SHA256` in both Dockerfiles. The build fails with a clear message if they do not match.
- Write `package-lock.json` with npm 11.19 or newer (`npm -v`). The images run `npm ci` with npm 11.19.1, which rejects lockfiles from npm 10 and from early npm 11 (11.6.1 was seen failing).
- `server/docker-compose.yml` is local-development infrastructure, not a production topology. Keep host ports loopback-bound and admin UIs opt-in through the `tools` profile.

## Non-obvious security rules

- Never commit `.env` files, credentials, tokens, or production data. Never place a secret in `NEXT_PUBLIC_*` or client-side code.
- Authentication uses server-issued httpOnly cookies. Do not copy tokens into localStorage, sessionStorage, Redux, logs, URLs, or response bodies.
- Validate every external input at the server boundary with Zod, use Prisma parameterization, enforce authorization in server services/routes, and return user-safe errors. Wrong input always answers 422 `VALIDATION_FAILED` with `error.fields` (field + message, never the submitted values); the client reads them with `getFieldErrors`.
- Preserve origin/CORS checks for state-changing cookie-authenticated requests, rate limits on public/auth-sensitive endpoints, and the split between statically served public uploads and authenticated owner-scoped private files.

## Required security workflow

- For every meaningful server implementation, bug fix, refactor, dependency update, or configuration change, use the repository-local `security-audit` skill in guidance mode while designing and reviewing the change. Treat authentication, authorization, validation, database access, outbound requests, uploads, cookies, CORS/origin handling, rate limits, environment configuration, and deployment behavior as security-sensitive surfaces.
- The same workflow applies to client changes in its security code: `client/src/middleware.ts` (security headers, CSP, route protection), the sign-in flow and its redirects (`client/src/features/auth/`), the shared API client (`client/src/lib/api/axios.config.ts`), and anything that renders HTML or untrusted URLs.
- Before completion, review the patch you are handing over: `git diff HEAD` plus every untracked file (`git status --porcelain`). In Codex, use the Codex Security plugin's `codex-security:security-diff-scan` skill when it is installed. In Claude Code, run the bundled `security-audit` skill in guidance mode on that diff. Claude Code's `/security-review` is not this check: it reviews only `git diff origin/HEAD...` (commits since the remote branch), so it never sees uncommitted work, and a project that was never pushed has no `origin/HEAD` at all. Scope the review to the changed behavior and the supporting code needed to establish impact; do not expand it into an unrelated repository audit.
- If Codex's scan is unavailable, perform the same focused patch review with the bundled `security-audit` skill and explicitly report that the scan was unavailable. Do not skip the security gate silently.
- A full or deep repository audit remains explicit work: do not start one merely because ordinary server code changed. Fix confirmed in-scope findings, rerun affected checks, and disclose any unresolved or unverified security concern before claiming completion.
- Documentation-only, comment-only, and formatting-only changes may skip the patch scan when they cannot affect runtime behavior, permissions, deployment, or security policy.

## Verification

- Server (`server/`): `npm run lint`, `npm run typecheck`, `npm test` (unit), `npm run test:coverage` (fails below the floor in `vitest.config.ts`; do not lower it to make a change pass), `npm run test:integration`, `npm run build`. Client (`client/`): `npm run lint`, `npm run typecheck`, `npm run build`. Run the ones that cover what you changed.
- `npm run test:integration` needs a real MySQL and Redis: either `INTEGRATION_DATABASE_URL` (a database whose name ends in `_test`) and `INTEGRATION_REDIS_URL` (Redis database 1-15), or Docker for Testcontainers. If neither is available, say that the integration tests did not run instead of reporting the change as tested.
- Never run `npm run prisma:reset` (`prisma migrate reset`) or `prisma db push` against a database that was not created for the test: they delete or rewrite its data. The integration suite empties its own test database.
- Database and deployment changes also require migration/Docker compatibility checks.
