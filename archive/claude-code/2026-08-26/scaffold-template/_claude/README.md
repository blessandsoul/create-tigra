# Claude Assistant Rules

This directory contains project-specific rules and guidelines for Claude.

## Directory Structure

```
.claude/
├── README.md                    # This file
└── rules/
    ├── global/                  # Cross-cutting rules (always active)
    │   └── core.md              # Safe editing, TypeScript, git, env, testing
    ├── client/                  # Next.js App Router rules
    │   ├── core.md              # Index — which file to read for what
    │   ├── 01-project-structure.md
    │   ├── 02-components-and-types.md
    │   ├── 03-data-and-state.md
    │   ├── 04-design-system.md
    │   ├── 05-security.md
    │   └── 06-ux-checklist.md
    └── server/                  # Fastify backend rules
        ├── core.md              # Index — which file to read for what
        ├── project-conventions.md
        ├── response-handling.md
        └── database.md
```

## For Claude

- This directory is the source of truth for project rules.
- **Don't read every file upfront.** Start with the relevant `core.md` index and follow it to the file you need.
- `global/core.md` always applies. `client/` and `server/` rules apply based on which directory you're working in.

## Key Principles (TL;DR)

### Global
- TypeScript strict, no `any`, Zod validation, explicit return types
- Small focused changes, extend don't rewrite, protect critical flows
- Conventional commits, `.env` never committed, tests for non-trivial changes

### Server
- **Stack**: Node.js, Fastify, TypeScript, MySQL, Prisma, Redis
- **Architecture**: Routes → Controllers → Services → Repositories → DB
- **API**: All routes prefixed with `/api/v1`
- **Responses**: `successResponse()` / `paginatedResponse()` — no custom shapes
- **Errors**: Only `AppError` subclasses, global error handler formats everything

### Client
- **Stack**: Next.js App Router, React Query, Redux (auth only), shadcn/ui, Tailwind
- **Architecture**: Server Components by default, `'use client'` only when needed
- **State**: Server data → Server Components or React Query. Redux → auth only. URL → filters/pagination
- **Design**: Semantic color tokens only, no hardcoded colors, neuro-minimalist aesthetic
- **Components**: Max 250 lines, max 5 props, max 3 JSX nesting levels
