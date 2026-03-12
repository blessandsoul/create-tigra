> **SCOPE**: These rules apply to the **entire workspace** (server + client). Always active.

# Task Completion Reports

When you finish a task, phase, or multi-step implementation, you MUST provide a structured completion report. Freeform paragraphs like "Fixed issues and completed remaining tasks" are not acceptable. The report must give the user a clear, scannable picture of everything that changed, why, and what to do next.

---

## When to Report

| Situation | Report required? |
|-----------|-----------------|
| Completed a full task or feature | **Yes — Full Report** |
| Completed a phase in a multi-phase plan | **Yes — Phase Report** (subset of Full Report) |
| Fixed a bug | **Yes — Bug Fix Report** |
| Small config change, typo fix, single-file edit | **No** — a 1-2 sentence explanation is fine |

---

## Full Report Template

Use this structure after completing a feature or multi-phase task. Omit sections that don't apply (e.g., skip "Database Changes" if no migrations were created), but never omit "Files Changed" or "How to Test".

```
## Summary
[1-3 sentences: what was built/changed and why]

## Files Changed

### Created
- `path/to/file.ts` — [purpose: what this file does]

### Modified
- `path/to/file.ts` — [what changed and why]

### Deleted
- `path/to/file.ts` — [why it was removed]

## New API Endpoints (if applicable)
| Method | Path | Auth | Description |
|--------|------|------|-------------|

## Database Changes (if applicable)
- Migration: `YYYYMMDD_name` — [what it does]
- New tables: [list]
- Modified tables: [what changed]
- Indexes added: [list]

## Environment Variables (if applicable)
| Variable | Required | Where | Description |
|----------|----------|-------|-------------|
[Where = .env / .env.example / Dockerfile ARG / Coolify]

## Dependencies Added (if applicable)
| Package | Purpose |
|---------|---------|
- Note if any require system-level installs (apk add)

## Key Decisions & Trade-offs
[Explain non-obvious choices. Why was approach A chosen over B? What assumptions were made? What are the limitations?]

## Deployment & Production Impact (if applicable)
[This section is REQUIRED whenever changes affect deployment, infrastructure, or production behavior. Include ALL that apply:]

### Dockerfile Changes
- [New ARG/ENV added, new COPY lines, new apk packages, port changes, etc.]

### Environment / Coolify Configuration
- [New env vars that must be set in Coolify/hosting platform]
- [Build arguments that must be added]
- [Volume mounts needed]

### Database Migration Required
- [Migration name and what it does]
- [Must run `prisma migrate deploy` before/after deploying]
- [Any data migration or backfill needed]

### Infrastructure Changes
- [New external services required (Redis, S3, third-party APIs)]
- [DNS/domain changes needed]
- [SSL/certificate changes]
- [New cron jobs or background workers]

### Deployment Order
- [If server and client must be deployed in a specific order, state it]
- [If a migration must run before the new code deploys, state it]

### Rollback Plan
- [What happens if this deployment fails — is it safe to roll back?]
- [Are the database changes backwards-compatible with the previous code version?]

## Breaking Changes (if any)
- [What breaks, what to update, and how]

## Manual Steps Required
1. [Ordered list of things the user must do before this works]
   - e.g., "Add GEMINI_API_KEY to .env"
   - e.g., "Run npm run prisma:migrate dev"

## How to Test
1. [Step-by-step verification the user can follow]
   - Be specific: exact commands, exact Postman steps, exact URLs
   - Include expected responses where helpful

## Known Limitations / TODOs (if any)
- [Things not yet implemented, edge cases not handled, future improvements needed]
```

---

## Phase Report Template

Use this when completing one phase of a multi-phase plan. Shorter than a Full Report but still structured.

```
## Phase N Complete: [Phase Title]

### What was done
- [Bullet list of concrete changes]

### Files Changed
- `path/to/file.ts` — [what and why]

### Key Decisions
- [Any non-obvious choices made during this phase]

### Blockers or Concerns
- [Anything that might affect subsequent phases]

### Phase Status
- [x] Phase N complete
- [ ] Phase N+1: [title] — next
```

---

## Bug Fix Report Template

```
## Bug Fix: [Short description]

### Root Cause
[What was actually wrong — not just the symptom, but the underlying cause]

### Fix Applied
- `path/to/file.ts` — [what changed]

### Why This Fix
[Why this approach was chosen. What other approaches were considered and rejected.]

### How to Verify
1. [Steps to confirm the fix works]

### Regression Risk
- [Could this fix break anything else? What was checked?]
```

---

## Rules

1. **Structure over prose.** Use the templates above. Tables, bullet points, and headers — not paragraphs.
2. **Every file gets a "why".** Don't just list `file.ts` — explain what changed and why. "Added creditBalance: 0 to mocks" → "Added `creditBalance: 0` to user mocks in `setup.ts` because the new credits module added this required field to the User model, and existing test fixtures would fail validation without it."
3. **Be specific in "How to Test".** Not "use Postman to test." Instead: "1. POST `{{baseUrl}}/auth/login` with test credentials. 2. POST `{{baseUrl}}/generations` with body `{ templateId: '...', image: <file> }`. 3. Expected: 201 with `{ success: true, data: { id, status: 'pending' } }`."
4. **Explain decisions, not just actions.** "Used upsert for seed data" → "Used `upsert` instead of `create` for seed data so the seed script is idempotent — running it twice won't throw duplicate key errors."
5. **Surface what the user needs to do.** If the user must add an env var, run a migration, install something, or restart a service — put it in "Manual Steps Required" prominently. Don't bury it in a paragraph.
6. **Honest about limitations.** If something is incomplete, has edge cases, or needs future work — say so in "Known Limitations." Don't pretend everything is perfect.
7. **Scale to the task.** A 5-phase feature gets a full report with every section. A single service method gets a shorter report. Use judgment, but always use the structured format.
8. **Deployment impact is never optional.** If ANY of the following changed, the "Deployment & Production Impact" section is REQUIRED — no exceptions:
   - New or modified environment variables
   - New npm packages with native dependencies
   - Database schema changes (new tables, columns, indexes)
   - Dockerfile modifications needed
   - New external service dependencies (APIs, Redis, S3, etc.)
   - Port, entry point, or health check changes
   - File upload/storage changes requiring volume mounts
   - Changes to build process or build arguments
   If none of these apply, explicitly state: "No deployment impact — no infrastructure, env, or database changes."
