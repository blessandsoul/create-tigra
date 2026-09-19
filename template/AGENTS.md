# Tigra Codex instructions

## MUST FOLLOW — comment important code

Every implementation change MUST include a human-readability pass. Add or update concise comments or doc comments for important functionality and for non-obvious contracts, invariants, edge cases, business rules, security boundaries, deployment constraints, performance choices, and workarounds. Explain why and what must remain true; do not narrate obvious syntax. Keep comments accurate and remove stale ones.

## Architecture and sources of truth

- `client/` is a Next.js App Router application; `server/` is a Fastify API backed by Prisma/MySQL and Redis. They deploy independently.
- The server owns authorization, business rules, and security validation. Client validation exists for UX and is never a trust boundary.
- `server/prisma/schema.prisma` is the database-schema source of truth. Use Prisma migrations for schema changes.
- `server/src/config/env.ts` and `client/src/lib/env.ts` define valid environment variables. Keep the corresponding `.env.example` files synchronized without real credentials.
- Shared route/API constants, response helpers, and security middleware are canonical; extend them instead of creating competing shapes or duplicate policy.

## Naming

- Use functional kebab-case for project names and anything surfaced in CLIs, logs, queues, jobs, or worker/process names.
- Use camelCase for TypeScript values/functions, PascalCase for components/types/classes, and UPPER_SNAKE_CASE for true constants.
- Keep domain folders and route paths lowercase and functional; follow the scoped client/server naming rules below.

## Deployment boundaries

- The Dockerfile in each app is its production contract. Re-check it when changing ports, entry points, build output, native dependencies, runtime files, health routes, or environment variables.
- The client must retain Next.js `output: "standalone"`; every `NEXT_PUBLIC_*` value is public and must be available at Docker build time.
- The server container applies `prisma migrate deploy` before startup and exposes unauthenticated `GET /api/v1/live` for orchestration.
- `server/docker-compose.yml` is local-development infrastructure, not a production topology. Keep host ports loopback-bound and admin UIs opt-in through the `tools` profile.

## Non-obvious security rules

- Never commit `.env` files, credentials, tokens, or production data. Never place a secret in `NEXT_PUBLIC_*` or client-side code.
- Authentication uses server-issued httpOnly cookies. Do not copy tokens into localStorage, sessionStorage, Redux, logs, URLs, or response bodies.
- Validate every external input at the server boundary with Zod, use Prisma parameterization, enforce authorization in server services/routes, and return user-safe errors.
- Preserve origin/CORS checks for state-changing cookie-authenticated requests, rate limits on public/auth-sensitive endpoints, and the split between statically served public uploads and authenticated owner-scoped private files.

## Required server security workflow

- For every meaningful server implementation, bug fix, refactor, dependency update, or configuration change, use the repository-local `security-audit` skill in guidance mode while designing and reviewing the change. Treat authentication, authorization, validation, database access, outbound requests, uploads, cookies, CORS/origin handling, rate limits, environment configuration, and deployment behavior as security-sensitive surfaces.
- Before completion, use the Codex Security plugin's `codex-security:security-diff-scan` skill to review the current working-tree patch when that plugin skill is available. Scope the review to the changed server behavior and the supporting code needed to establish impact; do not expand it into an unrelated repository audit.
- If Codex Security is unavailable, perform an equivalent focused patch review with the bundled `security-audit` skill and explicitly report that the plugin scan was unavailable. Do not skip the security gate silently.
- A full or deep repository audit remains explicit work: do not start one merely because ordinary server code changed. Fix confirmed in-scope findings, rerun affected checks, and disclose any unresolved or unverified security concern before claiming completion.
- Documentation-only, comment-only, and formatting-only changes may skip the patch scan when they cannot affect runtime behavior, permissions, deployment, or security policy.

## Verification

Run the smallest relevant lint, typecheck, test, and build commands in each affected app. Database and deployment changes also require migration/Docker compatibility checks.
