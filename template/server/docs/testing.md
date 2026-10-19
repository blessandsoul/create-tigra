# Testing

Two suites, both Vitest:

| Suite | Command | Needs | What it proves |
|---|---|---|---|
| Unit | `npm test` | nothing (no database, no network) | the logic of each module, with the database and Redis mocked |
| Integration | `npm run test:integration` | a MySQL and a Redis (see below) | the real app answering real requests (`app.inject`) against a real MySQL and Redis |

Run both before you push. Coverage: `npm run test:coverage` (unit suite).

## Integration tests: where MySQL and Redis come from

**Testcontainers (default, and what CI uses).** With neither variable below set, the suite starts a throwaway
MySQL 8.4 and Redis 7 in Docker, once per run, and removes them afterwards. Docker must be running.

**Services you already run.** Set both:

```bash
INTEGRATION_DATABASE_URL="mysql://user:password@127.0.0.1:3306/myapp_test" \
INTEGRATION_REDIS_URL="redis://127.0.0.1:6379/15" \
npm run test:integration
```

No container is started. **The suite drops every table in that database and flushes that Redis database**, so it
refuses anything that does not look disposable:

- the database name must end in `_test` (create it first, for example `CREATE DATABASE myapp_test`);
- the Redis URL must name a database from 1 to 15 (database 0, the default, is refused);
- setting only one of the two variables is refused.

The messages name the rule, never the URL.

Either way the schema comes from `prisma/migrations` (`prisma migrate deploy`), the same migrations production
applies, so a migration that does not match the code fails here first.

## Writing integration tests

- Name the file `*.integration.test.ts`; `npm test` skips those.
- Use the helpers in `src/test/integration-helpers.ts`: `buildTestApp()`, `registerUser()` / `registerAdmin()`
  (signed in, with a cookie jar per device), `call()` for requests, `db()` / `redis()` for checking stored state,
  `uploadAvatar()`, and `startEmailStub()`, a local stand-in for Resend that catches every email (nothing is sent).
- Every new route gets a row in `src/__tests__/routes.integration.test.ts`: who may call it (401/403), what wrong
  input answers (422) and its success answer. Deeper behaviour goes in the area's own integration file.
- Import the app lazily, inside `beforeAll` (`const { buildApp } = await import('@/app.js')`): the environment is
  set by `src/test/integration.setup.ts` and must be in place before `env.ts` is loaded.
- All files share one database and Redis and run one after another. Create your own data with unique emails; never
  rely on what another file left behind.
- Rate limits and email verification are off in this suite. A file that tests them switches them on in its
  `process.env` before importing the app (each file runs with fresh modules).

## CI

`.github/workflows/ci.yml` (project root) runs on every push and pull request: typecheck, lint,
`npm run test:coverage`, the server build, `npm run test:integration` (Testcontainers on GitHub's Ubuntu runners)
and the client's typecheck, lint and build. It never deploys.

## Coverage

`npm run test:coverage` counts every file in `src/` (type-only files and test helpers excluded) and fails below the
thresholds in `vitest.config.ts`. They are a ratchet: the real numbers when they were set, rounded down. Raise them
when you add tests; never lower them to make a change pass. Routes and controllers are tested by the integration
suite, which the coverage gate does not count.
