> **SCOPE**: These rules apply specifically to the **server** directory.

# Project Conventions

## Stack

| Technology | Purpose |
|------------|---------|
| Node.js 20+ LTS | Runtime |
| Fastify | HTTP framework (plugins, route prefixes, centralized error handling) |
| TypeScript (strict) | Language — always type parameters and return types |
| MySQL 8.0+ | Primary database |
| Prisma 6.x | ORM, migrations, schema source of truth |
| Redis | Caching (frequently accessed data, lookups), rate limiting, background task signaling |
| Zod | Runtime validation and type inference |
| JWT (HS256/RS256) | Auth — minimal token payload (id, role), role-based access control |
| PM2 + Nginx | Production deployment (cluster mode) |
| Jest / Vitest | Testing — deterministic, mock external APIs |

## Package Manager

Detect from lockfile: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else → npm.

## Folder Structure

```
src/
├── app.ts              # Fastify instance and plugin registration
├── server.ts           # listen() call only, no app logic
├── config/             # env, config, constants
├── libs/               # shared libraries (db, redis, logger, auth)
└── modules/<domain>/   # domain modules
    ├── <domain>.routes.ts
    ├── <domain>.controller.ts
    ├── <domain>.service.ts
    ├── <domain>.repo.ts
    ├── <domain>.schemas.ts
    └── <domain>.types.ts  (if needed)
```

New modules MUST follow `src/modules/<name>/` with the exact naming pattern above.

## API Routes

All routes prefixed with `/api/v1`. Grouped by domain: `/api/v1/<domain>/...`

Register routes as Fastify plugins in `<domain>.routes.ts`.

## Coding Style

- TypeScript `strict` mode ON
- `async/await` over `.then()`
- Named exports (except `src/app.ts` which default-exports the Fastify instance)
- Relative imports within a module (`./user.service`), aliased imports cross-module (`@modules/users/...`)
- Use `logger` from `src/libs/logger` — never `console.log`

## Layer Responsibilities

| Layer | MUST | MUST NOT |
|-------|------|----------|
| **Routes** | Register Fastify plugins, define HTTP method + path | Contain any logic |
| **Controllers** | Validate input (Zod), call services, return via `successResponse`/`paginatedResponse`, throw typed `AppError` | Business logic, direct DB access, manual error JSON, set HTTP status codes for errors |
| **Services** | All business logic, throw `AppError` subclasses, call repos for DB ops, be stateless | Touch Fastify (request/reply), format responses, return HTTP status codes |
| **Repositories** | Prisma queries, return raw data | Business logic, error formatting |

## Postman Collection

When API endpoints are created or modified, **always update the Postman collection** (`postman/collection.json`). If the collection does not exist, create it.

### Collection Structure

```
postman/
├── collection.json        # Postman v2.1 collection
└── environment.json       # Environment variables template
```

### Environment Variables

Use variables so requests are connected and portable:

```json
{
  "variables": [
    { "key": "baseUrl", "value": "http://localhost:3000/api/v1" },
    { "key": "accessToken", "value": "" },
    { "key": "refreshToken", "value": "" },
    { "key": "userId", "value": "" }
  ]
}
```

- **`{{baseUrl}}`** — all request URLs use this prefix, never hardcoded hosts.
- **`{{accessToken}}`** / **`{{refreshToken}}`** — set automatically via login/register test scripts.
- **`{{userId}}`** and other IDs — captured from responses so subsequent requests can reference them.

### Auto-set Tokens via Test Scripts

The **Login** and **Register** requests MUST include a `Tests` script that stores tokens and user data into collection variables:

```javascript
if (pm.response.code === 200 || pm.response.code === 201) {
  const res = pm.response.json();
  pm.collectionVariables.set("accessToken", res.data.tokens.accessToken);
  pm.collectionVariables.set("refreshToken", res.data.tokens.refreshToken);
  pm.collectionVariables.set("userId", res.data.user.id);
}
```

### Auth Header

All authenticated requests use a collection-level or folder-level **Bearer Token** auth set to `{{accessToken}}`. Do not duplicate the auth header on every request — inherit from the parent folder.

### Folder Organization

Organize requests into folders matching domain modules:

```
Collection Root (Bearer Token: {{accessToken}})
├── Auth (No Auth)
│   ├── Register        → POST {{baseUrl}}/auth/register
│   ├── Login           → POST {{baseUrl}}/auth/login    [sets tokens]
│   ├── Refresh Token   → POST {{baseUrl}}/auth/refresh
│   └── Logout          → POST {{baseUrl}}/auth/logout
├── Users
│   ├── Get Me          → GET {{baseUrl}}/users/me
│   ├── Update Me       → PATCH {{baseUrl}}/users/me
│   └── Delete Me       → DELETE {{baseUrl}}/users/me
└── <Domain>            → One folder per module
    ├── List            → GET {{baseUrl}}/<domain>
    ├── Get by ID       → GET {{baseUrl}}/<domain>/{{<domain>Id}}
    ├── Create          → POST {{baseUrl}}/<domain>
    ├── Update          → PATCH {{baseUrl}}/<domain>/{{<domain>Id}}
    └── Delete          → DELETE {{baseUrl}}/<domain>/{{<domain>Id}}
```

### Rules

1. **Every route gets a request.** No endpoint should exist without a matching Postman request.
2. **Include example request bodies** for POST/PATCH/PUT with realistic placeholder data.
3. **Capture IDs from create responses** — add a `Tests` script that sets `{{<domain>Id}}` so Get/Update/Delete requests work without manual copy-paste.
4. **Auth folder uses "No Auth"** — login and register don't need tokens. All other folders inherit Bearer Token from the collection root.
5. **Keep it importable** — the collection must be valid Postman v2.1 JSON that anyone can import and run immediately after setting `baseUrl`.

## Security

- Validate all inputs with Zod schemas
- Never interpolate raw values into SQL — always use Prisma query builder
- Rate limit public endpoints
- Avoid N+1 queries — prefer joins or batched queries
