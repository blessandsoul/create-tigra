/**
 * Integration test setup — REAL Testcontainers, NOT mocks.
 *
 * This file is the load-bearing piece of the money-path integration harness.
 * It is wired via `vitest.integration.config.ts` → `setupFiles`, and is SEPARATE
 * from the Docker-free unit `src/test/setup.ts` (which mocks env/DB/Redis).
 *
 * ── The central gotcha: env-before-import ──────────────────────────────────
 * `src/config/env.ts` validates `process.env` at IMPORT time and calls
 * `process.exit(1)` if DATABASE_URL / JWT_SECRET / … are missing. So the
 * container connection strings MUST be in `process.env` BEFORE anything that
 * transitively imports `env.ts` (which is `@/app`, `@/libs/prisma`, etc.).
 *
 * How we guarantee that ordering:
 *   1. Vitest evaluates `setupFiles` — INCLUDING their top-level `await` — to
 *      completion BEFORE it evaluates any test module. We start the containers
 *      and run the schema sync here with TOP-LEVEL await, then populate
 *      process.env.
 *   2. The test files themselves import `@/app` / `@/libs/prisma` LAZILY
 *      (`await import(...)` inside `beforeAll`), so a test module's own static
 *      import graph never evaluates `env.ts` before this setup has finished.
 *
 * ── Why a process-global singleton ─────────────────────────────────────────
 * Vitest runs `setupFiles` ONCE PER TEST FILE, not once for the whole run. With
 * `singleFork: true` (vitest.integration.config.ts) every test file shares ONE
 * worker process, so we boot the MySQL + Redis containers exactly once and cache
 * them on `globalThis`. The second (and later) test files reuse the running
 * containers instead of each spinning up their own pair and racing two
 * concurrent `prisma db push` invocations against a saturated Docker daemon
 * (which produced intermittent `P1001: can't reach database server`).
 *
 * ── Teardown ───────────────────────────────────────────────────────────────
 * Because the containers are shared across files, we CANNOT tear them down from
 * a per-file `afterAll` (the first file to finish would stop the DB out from
 * under the others). Instead we stop them once on the worker process's
 * `beforeExit`, and rely on Testcontainers' Ryuk reaper as the backstop — it
 * removes any container we started the moment this process dies, even on crash.
 *
 * The committed template ships NO `prisma/migrations/` directory (apps run
 * `prisma migrate dev` locally to author their first migration). `prisma migrate
 * deploy` therefore has nothing to apply against a fresh container. We use
 * `prisma db push` instead — it syncs the Prisma schema straight to the empty
 * container database, which is exactly what an ephemeral test DB wants.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..', '..');

interface IntegrationContainers {
  mysql: StartedMySqlContainer;
  redis: StartedRedisContainer;
  databaseUrl: string;
  redisUrl: string;
  uploadPublicDir: string;
  uploadPrivateDir: string;
}

// Singleton cache on globalThis — survives across the per-file setup invocations
// that share one worker process (singleFork). Keyed under a unique symbol so it
// can't collide with anything else on the global object.
const CONTAINERS_KEY = Symbol.for('create-tigra.integration.containers');
const TEARDOWN_KEY = Symbol.for('create-tigra.integration.teardownRegistered');

type GlobalWithContainers = typeof globalThis & {
  [CONTAINERS_KEY]?: Promise<IntegrationContainers>;
  [TEARDOWN_KEY]?: boolean;
};

const g = globalThis as GlobalWithContainers;

async function bootContainers(): Promise<IntegrationContainers> {
  const mysql = await new MySqlContainer('mysql:8.0')
    .withDatabase('test_db')
    .withUsername('test')
    .withUserPassword('test')
    .withRootPassword('rootpass')
    .start();

  const redis = await new RedisContainer('redis:7-alpine').start();

  // MySqlContainer.getConnectionUri() returns `mysql://user:pass@host:port/db`
  // — exactly Prisma's DATABASE_URL shape.
  const databaseUrl = mysql.getConnectionUri();
  const redisUrl = redis.getConnectionUrl();

  // Populate env BEFORE any consumer of env.ts is imported.
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.JWT_SECRET = 'integration-test-jwt-secret-at-least-32-chars-long';
  process.env.JWT_ACCESS_EXPIRY = '15m';
  process.env.JWT_REFRESH_EXPIRY = '7d';
  // Tests don't send email and don't activate via the verify flow — register
  // must mint tokens and login must work immediately, so disable verification.
  process.env.REQUIRE_USER_VERIFICATION = 'false';
  // This is a money-PATH harness, not a rate-limit test. Disabling the limiter
  // keeps the suite deterministic (no per-IP counters, no auto-block self-ban
  // across repeated register/login calls).
  process.env.RATE_LIMIT_ENABLED = 'false';
  // In NODE_ENV=test the app's CORS config (see app.ts) is NOT the dev "allow
  // all" branch — it reads CORS_ORIGIN, and an undefined value makes
  // @fastify/cors throw "Invalid CORS origin option" → 500 on EVERY request.
  // Pin a concrete origin so the real app boots a valid CORS policy.
  process.env.CORS_ORIGIN = 'http://localhost:3000';

  // Two-tier upload dirs under an isolated temp root, set BEFORE env.ts is ever
  // evaluated (the storage-service singleton reads env.UPLOAD_*_DIR at
  // construction, which happens when a test lazily imports @/app). The
  // files-route integration test writes fixtures directly into these dirs.
  const uploadsRoot = path.join(os.tmpdir(), `create-tigra-uploads-${process.pid}`);
  const uploadPublicDir = path.join(uploadsRoot, 'public');
  const uploadPrivateDir = path.join(uploadsRoot, 'private');
  process.env.UPLOAD_PUBLIC_DIR = uploadPublicDir;
  process.env.UPLOAD_PRIVATE_DIR = uploadPrivateDir;

  // Sync the Prisma schema into the fresh container DB. `db push` (not
  // `migrate deploy`) because the template ships no migrations. The container's
  // wait strategy already guarantees MySQL is accepting connections by here.
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: serverRoot,
    env: process.env,
    stdio: 'inherit',
  });

  return { mysql, redis, databaseUrl, redisUrl, uploadPublicDir, uploadPrivateDir };
}

// Boot once (or await the in-flight boot) — TOP-LEVEL await, completes before
// any test module is evaluated.
if (!g[CONTAINERS_KEY]) {
  g[CONTAINERS_KEY] = bootContainers();
}
const containers = await g[CONTAINERS_KEY];

// Subsequent per-file setup runs need env populated too (the boot only set it on
// the first run). Re-assert from the cached values — cheap and idempotent.
process.env.DATABASE_URL = containers.databaseUrl;
process.env.REDIS_URL = containers.redisUrl;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'integration-test-jwt-secret-at-least-32-chars-long';
process.env.REQUIRE_USER_VERIFICATION = 'false';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.CORS_ORIGIN = 'http://localhost:3000';
process.env.UPLOAD_PUBLIC_DIR = containers.uploadPublicDir;
process.env.UPLOAD_PRIVATE_DIR = containers.uploadPrivateDir;

// Register the teardown exactly once for the whole run. Tied to the worker
// process lifecycle (NOT a per-file afterAll, which would stop the shared
// containers while later files still need them). Ryuk is the crash-safe backstop.
if (!g[TEARDOWN_KEY]) {
  g[TEARDOWN_KEY] = true;
  process.once('beforeExit', () => {
    void containers.redis.stop();
    void containers.mysql.stop();
  });
}

export const containerInfo = {
  databaseUrl: containers.databaseUrl,
  redisUrl: containers.redisUrl,
  uploadPublicDir: containers.uploadPublicDir,
  uploadPrivateDir: containers.uploadPrivateDir,
};
