# Quick Reference for AI Assistants

**Read this first, then dive into specific rule files as needed.**

---

If project is empty start server/client commands (`/create-server`, `/create-client`)

## How Rules Are Organized

Rules are scoped by directory:

| Scope | Path | Applies To |
|-------|------|------------|
| **Global** | `.claude/rules/global/` | Entire workspace (server + client) |
| **Server** | `.claude/rules/server/` | Backend (Fastify API server) only |
| **Client** | `.claude/rules/client/` | Frontend (Next.js App Router) only |

Always check which scope you're working in before writing code.

---

## Global Rules (Always Apply)

### Safe Editing
- Keep changes **small and focused**
- Preserve existing function signatures and exports unless explicitly asked
- Extend modules, don't rewrite
- Add `// TODO:` comments for ambiguities or follow-ups
- Never leave half-implemented features without explanation
- No noisy debug logs; mark temporary ones with `// TODO: remove debug log`
- Never delete or radically restructure large parts of the codebase
- Preserve existing behavior for critical flows (auth, payments, core business logic)

See: `global/core.md`

---

## Server Rules Summary

### Architecture
```
Request -> Routes -> Controller -> Service -> Repository -> Database
```

- **Controllers**: Validate input (Zod), call services, return responses, throw typed errors. NO business logic, NO direct DB access.
- **Services**: All business logic. Throw typed `AppError` instances. NO HTTP concepts (request/reply). Return data or throw.
- **Repositories**: Database queries only.

### Module Structure
```
src/modules/<domain>/
  <domain>.routes.ts
  <domain>.controller.ts
  <domain>.service.ts
  <domain>.repo.ts
  <domain>.schemas.ts
  <domain>.types.ts (optional)
```

### API Response Format (Mandatory)
```json
// Success
{ "success": true, "message": "...", "data": { ... } }

// Error
{ "success": false, "error": { "code": "ERROR_CODE", "message": "..." } }
```
- Use `successResponse()` / `paginatedResponse()` helpers
- Throw typed errors only (`AppError` subclasses)
- Global error handler formats all errors

### Auth Architecture
- **httpOnly cookies** for token storage (access_token + refresh_token)
- Account lockout with progressive thresholds
- Session tracking with device info and IP
- Transparent password rehash (bcrypt legacy -> argon2id)

### Database
- Schema changes via Prisma migrations only
- Development: `prisma:reset` freely; Production: `prisma:migrate deploy` only
- Prisma models: `PascalCase`; Fields: `camelCase`
- All main tables need: `id`, `createdAt`, `updatedAt`

### Code Style
- TypeScript strict mode, type all params and returns
- `async/await` over `.then()`
- Named exports (exception: `app.ts` default-exports `buildApp`)
- Use `logger` from `src/libs/`, never `console.log`
- Detect package manager from lockfile

See: `server/core.md`, `server/project-conventions.md`, `server/response-handling.md`, `server/database.md`

---

## Client Rules Summary

### Architecture
- Next.js App Router with Server Components by default
- Client Components only when interactivity is needed (`'use client'`)
- Feature modules under `src/features/<domain>/`

### Auth Flow
- **httpOnly cookies** — no tokens stored in Redux or localStorage
- `AuthInitializer` component hydrates user state on page load via `getMe()` API call
- Redux auth state: `{ user, isAuthenticated, isInitializing, isLoggingOut }`
- Axios `withCredentials: true` sends cookies automatically

### Module Structure
```
src/features/<domain>/
  components/
  hooks/
  services/
  store/ (Redux, if needed)
  types/
  actions/ (Server Actions, optional)
```

### State Management
| State Type | Tool |
|------------|------|
| Server data (SSR) | Server Components |
| Server data (client) | React Query |
| Global client state | Redux (auth only) |
| Local state | useState / useReducer |
| URL state | useSearchParams |

### Component Rules
- Max 250 lines per component
- Max 5 props (use object if more)
- Max 3 levels of JSX nesting
- Use `cn()` for conditional classes
- Use Next.js `Image` and `Link` components
- Follow import order: React/Next -> third-party -> UI -> local -> hooks -> services -> types -> utils

### Styling
- Tailwind CSS v4 only, no inline styles
- OKLCH color space via CSS custom properties
- Use semantic color tokens (e.g., `bg-primary`, `text-foreground`)
- Never hardcode hex/rgb values
- Pair backgrounds with foregrounds for contrast

### Forms
- React Hook Form + Zod for complex forms
- Server Actions for simple forms
- Always validate client-side AND server-side

### Security
- Never inject raw HTML without sanitization (use DOMPurify)
- Never prefix secrets with `NEXT_PUBLIC_`
- Validate all inputs, sanitize all outputs
- Secure external links with `rel="noopener noreferrer"`

See: `client/core.md`, `client/01-project-structure.md` through `client/06-ux-checklist.md`

---

## When Implementing Features

1. **Identify scope** - Are you working in server, client, or both?
2. **Read relevant rules** - Check the scoped rule files for that directory
3. **Summarize** what needs to be done
4. **List** files to create/modify
5. **Provide** complete code for each file
6. **Mention** migrations, env variables, or dependencies needed
7. **State assumptions** if unsure

---

## Full Documentation Index

### Global
- `global/core.md` - Safe editing, TypeScript, git, env, testing rules

### Server
- `server/core.md` - Index and non-negotiables
- `server/project-conventions.md` - Stack, folder structure, coding style, Postman
- `server/response-handling.md` - Response contract, error classes
- `server/database.md` - Database standards, migrations, indexing

### Client
- `client/core.md` - Architecture and non-negotiables
- `client/01-project-structure.md` - Folder structure, naming, imports, constants
- `client/02-components-and-types.md` - Component rules, TypeScript, API types
- `client/03-data-and-state.md` - State management, React Query, Redux, Axios, forms
- `client/04-design-system.md` - Colors, typography, spacing, motion, dark mode
- `client/05-security.md` - Token storage, env vars, CSP, validation
- `client/06-ux-checklist.md` - Cognitive load, accessibility, performance

---

**Last Updated**: 2026-02-20
