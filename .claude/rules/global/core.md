> **SCOPE**: These rules apply to the **entire workspace** (server + client). Always active.

# Global Rules

These rules are always in effect regardless of which directory you are working in.

---

## New Project Setup

When the user asks to create, scaffold, or start a new server or client project, **always run `/create-server` or `/create-client` first** before writing any code. These commands contain the full scaffolding templates, dependency lists, and boilerplate that match our architecture. Do not attempt to scaffold a project from memory.

---

## Safe Editing

1. **Small, focused changes**: Only modify what's necessary. Don't restructure code unless asked.
2. **Preserve signatures**: Don't change existing function signatures, exports, or imports unless explicitly requested.
3. **Extend, don't rewrite**: Add to existing modules. Don't gut and rebuild.
4. **Protect critical flows**: Never break existing auth, core business flows, or payment logic.
5. **No half-done work**: If something is incomplete, add a `// TODO:` with explanation.
6. **No noisy logs**: No debug logs in production code. Mark temporary ones with `// TODO: remove debug log`.
7. **Call out breaking changes**: If a breaking change is unavoidable, state it clearly in your explanation.
8. **Assume production**: Treat this as a real production project. Avoid destructive or experimental changes.

---

## TypeScript

- **Strict mode ON** in both client and server. No exceptions.
- **No `any`** — use `unknown` if the type is truly unknown.
- **Explicit return types** on all functions.
- **Always `import type`** for type-only imports.
- **Validate all inputs with Zod** — client-side for UX, server-side for security.

---

## Git & Branching

- **Branch naming**: `feature/<name>`, `fix/<name>`, `chore/<name>`, `hotfix/<name>`.
- **Commit messages**: Use conventional commits — `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`.
  - Keep the subject line under 72 characters.
  - Use imperative mood: "Add search filter" not "Added search filter".
- **Never commit**: `.env` files, secrets, `node_modules`, build artifacts, OS files (`.DS_Store`, `Thumbs.db`).
- **One logical change per commit**. Don't mix unrelated changes.

---

## Environment & Configuration

- **`.env` files are never committed.** Use `.env.example` as the template with placeholder values.
- **Adding a new env var**: Add it to `.env.example` with a comment, and document where it's used.
- **Secrets** (DB URLs, JWT secrets, API keys) must never be prefixed with `NEXT_PUBLIC_` and must never appear in client-side code.
- **Public values only** (API base URL, app name) get the `NEXT_PUBLIC_` prefix.

---

## Testing

- **New features and bug fixes should include tests** unless the change is trivial (copy, config, styling).
- **Test naming**: `describe('<ModuleName>')` → `it('should <expected behavior>')`.
- **Tests must be deterministic**: No reliance on real time, network, or random values. Mock external dependencies.
- **Don't test implementation details** — test behavior and outputs.

---

## Code Review Checklist

Before considering work done, verify:

- [ ] No `any` types.
- [ ] No hardcoded values (URLs, colors, magic numbers) — use constants and tokens.
- [ ] No `console.log` left in code.
- [ ] No commented-out code without a `// TODO:` explaining why.
- [ ] Inputs validated with Zod.
- [ ] Error cases handled (not just the happy path).
- [ ] Existing tests still pass.
