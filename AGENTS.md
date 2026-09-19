# create-tigra Codex instructions

## MUST FOLLOW — comment important code

Every implementation change MUST include a human-readability pass. Add or update concise comments or doc comments for important functionality and for any non-obvious contract, invariant, edge case, security boundary, deployment constraint, performance choice, or workaround. Explain why the code exists and what must remain true; do not narrate obvious syntax. Keep affected comments accurate and remove stale ones.

## Architecture and sources of truth

- `bin/create-tigra.js` is the CLI entry point and copies `template/` into new applications.
- `template/` is the canonical scaffold. Fix new-project behavior there; generated scratch applications are not authoritative.
- `template/.agents/skills/` contains Codex-native repository skills copied into every generated application. Keep vendored licenses and source provenance with third-party skills.
- `modules/` contains optional feature payloads and `lib/patchers/` applies them to generated projects.
- Generated apps have an independent Next.js client and Fastify server. The server owns authorization, business rules, and security validation; the client owns presentation and UX validation.
- Within generated apps, `server/prisma/schema.prisma` owns the database model, each `src/lib/env.ts` or `src/config/env.ts` owns environment validation, and `client/src/middleware.ts` owns browser security headers and CSP.

## Naming

- Use functional kebab-case for project names and anything visible in CLIs, logs, or worker/process names.
- Client components use `PascalCase.tsx`, hooks use `use<Name>.ts`, and feature services/types use `<domain>.service.ts` / `<domain>.types.ts`.
- Server domains live in `src/modules/<domain>/` with `<domain>.routes.ts`, `.controller.ts`, `.service.ts`, `.repo.ts`, and `.schemas.ts`.
- TypeScript values/functions use camelCase, types/classes use PascalCase, and constants use UPPER_SNAKE_CASE when they are true constants.

## Deployment and security boundaries

- `template/client/Dockerfile` and `template/server/Dockerfile` are production contracts for Docker/Coolify. Preserve the client standalone output, the server migrate-on-boot command, non-root runtimes, writable upload ownership, and health checks.
- `template/server/docker-compose.yml` is local development infrastructure only. Keep published services loopback-bound and admin tools behind the `tools` profile.
- Never commit real secrets or place secrets in `NEXT_PUBLIC_*`; public client variables are build-time Docker arguments.
- Keep authentication tokens in server-issued httpOnly cookies. Enforce authorization, Zod validation, origin/CORS checks, and safe error responses on the server even when the client also validates.
- Preserve the public/private upload boundary: public files may be statically served; private files require authenticated, owner-scoped routes.
- Generated applications require a focused security review for meaningful server changes. Preserve the mandatory workflow in `template/AGENTS.md`, its scoped details in `template/server/AGENTS.md`, and the bundled `security-audit` fallback when changing Codex integration.

<!-- gitnexus:start -->
# GitNexus — one-shot CLI

This repository is indexed by GitNexus as **create-tigra**. For structural code questions only, use the globally installed `gitnexus` CLI through short-lived terminal commands.

- Check freshness with `gitnexus status` from this repository root.
- Explore a flow with `gitnexus query -r create-tigra "<concept>" -l 5`.
- Inspect a symbol with `gitnexus context -r create-tigra <symbol>`.
- Check blast radius with `gitnexus impact -r create-tigra <symbol> --direction upstream --depth 3`.
- Use `gitnexus cypher -r create-tigra "<read-only query>"` only when the smaller commands cannot answer the question.
- Confirm graph conclusions by reading source and running relevant tests.

Do not use GitNexus for general questions, prose, product/UX design, or trivial literal lookups. Never start `gitnexus mcp`, `serve`, `eval-server`, or `setup`; never launch it in the background; never use `npx` for it. Do not run `analyze` automatically. If the index is missing or stale, use source search and mention it briefly. When Tornike explicitly requests indexing, run `gitnexus analyze --skip-agents-md` and do not enable embeddings unless requested.

Use at most three graph commands per task unless Tornike asks for a deeper graph investigation. If a command fails or hangs, stop and fall back to source inspection instead of retrying in a loop.
<!-- gitnexus:end -->
