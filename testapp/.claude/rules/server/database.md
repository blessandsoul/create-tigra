> **SCOPE**: These rules apply specifically to the **server** directory.

# Database & Migrations

## Principles

- **Database**: MySQL 8.0+
- **ORM**: Prisma 6.x (do NOT upgrade to 7.x without testing)
- **Schema source of truth**: `prisma/schema.prisma`
- **Dev**: Fast iteration with resets. **Prod**: Safe, forward-only migrations.

---

## Critical Rules

| Rule | Detail |
|------|--------|
| Schema changes | Prisma migrations ONLY. Never raw DDL. Data changes (INSERT/UPDATE/DELETE) can be raw SQL. |
| Dev conflicts | Don't fix migration files manually. Run `prisma:reset` then `prisma:seed`. |
| `db push` | Prototyping only. NEVER in production. |
| `prisma:reset` | Freely in dev. NEVER in production. |
| Production deploys | ONLY `prisma:migrate deploy`. Never reset, never manual edits. |

---

## Naming Conventions

| Entity | Format | Example |
|--------|--------|---------|
| Tables | `snake_case` plural | `users`, `order_items` |
| Columns | `snake_case` | `user_id`, `created_at` |
| Foreign keys | `<table_singular>_id` | `user_id`, `category_id` |
| Prisma models | `PascalCase` singular | `User`, `OrderItem` |

---

## Required Fields

Every main entity table MUST have:
```prisma
model EntityName {
  id        String   @id @default(uuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  // Optional:
  deletedAt DateTime?            // Soft deletes (prefer for user content)
  isActive  Boolean @default(true) // Disable without deleting
}
```

---

## Relationships

- Use proper foreign keys with `onDelete: Cascade` for dependent data
- Explicit junction tables for many-to-many (not implicit)
- Normalize shared lookup data into own tables (no duplicated strings)
- Polymorphic attachments: use `entityType` + `entityId` with `@@index([entityType, entityId])`
- **Column renames**: Two-step migration — add new column, migrate data, then drop old column. Renaming directly DROPS data.

---

## Indexing

**Always index:** foreign keys, filter columns (WHERE clauses), composite filters, unique constraints.

**Never index:** low-cardinality booleans alone, text/blob columns, fields not used in WHERE/ORDER BY.

```prisma
@@index([userId])                    // Foreign key
@@index([categoryId, isActive])      // Composite filter
@@unique([email])                    // Unique constraint
```

---

## Migration Workflow

1. Edit `prisma/schema.prisma`
2. Run: `npm run prisma:migrate dev --name descriptive_name`
3. If conflict: `npm run prisma:reset` then `npm run prisma:seed`
4. Verify generated SQL and use `prisma:studio` to inspect

**Adding NOT NULL column**: Must provide a default value or make it optional, otherwise Prisma will error.

---

## Production Deployment

**Pre-deploy**: All migrations tested locally, seed runs, migration files committed to git.

```bash
npm run prisma:migrate deploy  # Apply pending migrations (safe)
npm run prisma:generate        # Regenerate client
npm start                      # Restart application
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `DATABASE_URL` not found | Verify `.env` exists with valid `DATABASE_URL`. If Prisma 7 issue, downgrade to v6. |
| "Table already exists" | `npm run prisma:reset` (dev only) |
| "Prisma Client is not generated" | `npm run prisma:generate` |
| Slow queries | Add missing indexes via schema, use `EXPLAIN`, use `select` to limit fields |

---

## Commands Reference

```bash
# Development
npm run prisma:studio         # Visual DB browser
npm run prisma:migrate dev    # Create migration
npm run prisma:reset          # Drop all, rerun migrations
npm run prisma:seed           # Repopulate test data
npm run prisma:generate       # Regenerate client

# Production
npm run prisma:migrate deploy # Apply migrations (safe)
npm run prisma:generate       # Regenerate client
```
