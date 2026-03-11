> **SCOPE**: These rules apply specifically to the **server** directory (Fastify backend).

# Server Rules — Core Index

**Do NOT read every rule file upfront.** Use this index to find the right rules for your current task.

---

## When to read which file

| You are doing... | Read this |
|------------------|-----------|
| Setting up a module, organizing code, understanding the stack | `project-conventions.md` |
| Creating or modifying a route / controller | `project-conventions.md` + `response-handling.md` |
| Returning data (success, error, or paginated) | `response-handling.md` |
| Handling or throwing errors | `response-handling.md` |
| Writing service or business logic | `project-conventions.md` (Layer Responsibilities) |
| Changing DB schema, migrations, indexes | `database.md` |
| Adding or changing API endpoints | `project-conventions.md` (Postman Collection) |
| Unsure where to start | This file |

---

## Architecture at a glance

```
Request
  -> Route (Fastify plugin, defines HTTP method + path)
  -> Controller (validates input with Zod, calls service, returns response)
  -> Service (business logic, throws typed errors)
  -> Repository (Prisma queries, returns raw data)
  -> Database
```

**Three strict boundaries:**
1. **Controllers** — parse input, call services, format responses. No business logic. No direct DB access.
2. **Services** — all business logic. No Fastify concepts (request, reply). Throw typed `AppError` instances.
3. **Repositories** — Prisma queries only. No business logic. No error formatting.

---

## Non-negotiable rules (always apply)

1. **Response format**: All controllers use `successResponse()` / `paginatedResponse()`. No custom shapes.
2. **Error handling**: Only throw `AppError` subclasses. Never raw `Error` or strings. Global error handler formats all errors.
3. **Validation**: All input validated with Zod schemas before reaching services.
4. **Database changes**: Always via Prisma migrations. Never raw DDL.
5. **Logging**: Use `logger` from `src/libs/logger`. Never `console.log`.
6. **Routes**: All prefixed with `/api/v1`. Registered as Fastify plugins.
7. **Postman**: Every new or modified endpoint must be reflected in `postman/collection.json`. Create the collection if it doesn't exist.
