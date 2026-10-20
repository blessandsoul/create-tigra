# Server agent instructions

## Architecture and naming

- Request flow is route → controller → service → repository → Prisma. Routes register HTTP/schema metadata; controllers translate HTTP input/output; services own business rules; repositories contain database queries only.
- Domain modules live in `src/modules/<domain>/` with `<domain>.routes.ts`, `.controller.ts`, `.service.ts`, `.repo.ts`, and `.schemas.ts`.
- All API routes use the `/api/v1` prefix. Use the shared `successResponse`, `paginatedResponse`, and typed `AppError` contracts rather than custom response/error shapes.
- Use the shared logger and outbound HTTP client. Never add ad-hoc `console.log`, raw `fetch`, or per-call HTTP clients that bypass redaction, timeouts, and error mapping.
- Fetch a URL that came from a user (a link, webhook, import or avatar URL) only with `safeHttpClient` (`src/libs/safe-http.ts`), never `httpClient` or `fetch`: it refuses internal addresses on every hop.
- Recurring work (cleanups, syncs, reminders) goes through `startRecurringJob` (`src/jobs/schedule.ts`), registered in `src/jobs/index.ts`, never a bare `setInterval`: it first runs about a minute after every start, so frequent deploys never postpone it, and a run never overlaps the previous one.

## Sources of truth

- `prisma/schema.prisma` owns models, relations, indexes, and database naming. Change schema through reviewed Prisma migrations; production is forward-only with `prisma migrate deploy`. `prisma/migrations/0_init` (shipped with the template) creates the first tables; never edit or delete an applied migration, add a new one with `npm run prisma:migrate:dev`. Every deploy applies new migrations while the old version is still serving (`docs/deployment.md`): never drop, rename, retype or make a column required in the same deploy as the code that stops using it. Prisma writes a renamed field as drop + add, which loses the data; to rename only in the code, keep the database name with `@map` / `@@map`.
- `src/config/env.ts` owns runtime configuration validation. Keep `.env.example` and `.env.example.production` synchronized, but keep real secrets out of the repository and image.
- Zod route schemas own external input validation. Services own authorization and business invariants; repositories must not decide access policy.
- Wrong input has one answer: 422 `VALIDATION_FAILED` with `error.fields` (`src/libs/validation-errors.ts`, applied by `src/libs/error-handler.ts` to route schemas and `ZodError`). Validate inside a handler with `parseInput(schema, data)`, never a hand-made `ValidationError(issues[0].message)`. Messages describe the rule; never put a submitted value into one.

## Security and deployment

- Preserve httpOnly cookie auth, production CORS allowlists, state-changing request origin checks, rate limiting, safe client IP handling, generic 500 responses, and server-side-only diagnostic logging.
- Rate limits have one source, `src/config/rate-limit.config.ts` (`docs/rate-limits.md` explains all of them). A new route gets the 200/min default automatically; give it its own `RATE_LIMITS` entry only when it needs another number. Every "slow down" answer must be a `TooManyRequestsError` (or `IP_BLOCKED`) carrying `retryAfterSeconds`. Any new flow that sends email anyone can trigger calls `consumeEmailQuota(email)` before looking up the account (public counter); only flows that prove the owner (e.g. a correct password) may use their own counter.
- Use Prisma parameterization and explicit safe projections; never expose password hashes, tokens, internal errors, or secret-bearing upstream payloads.
- Keep public uploads under the static public root. Private uploads stay outside it and are served only through authenticated, owner-scoped routes; preserve filename/path validation.
- The production image runs non-root, refuses to start without any migration, applies `prisma migrate deploy` before `node dist/server.js`, and probes unauthenticated `GET /api/v1/live`. In production the server also refuses to start when Redis is not reachable within 10 s (`src/server.ts`): keep that refusal, since rate limits, login lockout and IP blocks would otherwise be off. Preserve writable ownership for runtime storage and add explicit Alpine packages for new native runtime dependencies.

## Tests

- Integration tests run the real app against MySQL and Redis (see the root `AGENTS.md`, Verification, for what they need). Build them from `src/test/integration-helpers.ts` (`buildTestApp`, `call`, `registerUser`, `registerAdmin`, `startEmailStub`, …) instead of new setup code.
- Every API route needs its contract in `src/__tests__/routes.integration.test.ts`: who may call it (401 anonymous, 403 the wrong user or role), wrong input (422 `VALIDATION_FAILED`) and its success answer. Its last test fails, naming the route, when a registered route is never called there; a route that another file tests goes in its `COVERED_ELSEWHERE` list with that file's name.

## Mandatory security completion gate

- Follow the root `AGENTS.md` security workflow for every meaningful server change: use `security-audit` guidance during implementation, then review the resulting patch (`git diff HEAD` plus untracked files) before completion, with `codex-security:security-diff-scan` in Codex or the bundled `security-audit` skill in Claude Code. Not `/security-review`: it reviews only commits since `origin/HEAD` and never sees uncommitted work.
- Review the concrete trust boundary, attacker-controlled input, affected principal/resource, authorization decision, validation point, and observable impact. Missing best practices without a reachable boundary failure are hardening notes, not confirmed vulnerabilities.
- Add or update focused regression coverage for changed authorization, validation, origin/CORS, cookie/session, upload/path, outbound-request, and data-isolation behavior. Never rely on client checks as security evidence.
- If a required security check cannot run, state the exact blocker and safe follow-up instead of reporting the server change as fully verified.
