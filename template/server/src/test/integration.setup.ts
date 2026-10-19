/**
 * Integration tests, once per test file (vitest.integration.config.ts →
 * setupFiles): the app's environment, pointed at the MySQL and Redis that
 * integration.global-setup.ts prepared once for the whole run. SEPARATE from
 * the Docker-free unit `src/test/setup.ts` (which mocks env/DB/Redis).
 *
 * ── The central gotcha: env-before-import ──────────────────────────────────
 * `src/config/env.ts` validates `process.env` at IMPORT time and calls
 * `process.exit(1)` if DATABASE_URL / JWT_SECRET / … are missing. So the
 * addresses MUST be in `process.env` BEFORE anything that transitively
 * imports `env.ts` (which is `@/app`, `@/libs/prisma`, etc.):
 *   1. Vitest evaluates `setupFiles` before it evaluates the test module.
 *   2. Test files import `@/app` / `@/libs/prisma` LAZILY (`await import(...)`
 *      inside `beforeAll`), so their own static imports never evaluate env.ts
 *      first.
 * Each test file runs with fresh modules, so a file may change process.env
 * before its lazy import (the rate-limit tests switch limits on this way).
 */
import { inject } from 'vitest';

const services = inject('integration');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = services.databaseUrl;
process.env.REDIS_URL = services.redisUrl;
process.env.JWT_SECRET = 'integration-test-jwt-secret-at-least-32-chars-long';
process.env.JWT_ACCESS_EXPIRY = '15m';
process.env.JWT_REFRESH_EXPIRY = '7d';
// Register mints tokens and login works at once, without the verify flow;
// the email module's own tests switch verification on in their file.
process.env.REQUIRE_USER_VERIFICATION = 'false';
// Rate limits are off by default so repeated register/login calls stay
// deterministic (no per-IP counters, no auto-block self-ban). The rate-limit
// test file switches them on for itself.
process.env.RATE_LIMIT_ENABLED = 'false';
// In NODE_ENV=test the app's CORS config (see app.ts) is NOT the dev "allow
// all" branch: it uses the checked CORS_ORIGIN list (env.CORS_ORIGINS).
// Pin a concrete origin so the real app boots a realistic CORS policy.
process.env.CORS_ORIGIN = 'http://localhost:3000';
// Two-tier upload dirs under an isolated temp root, set BEFORE env.ts is ever
// evaluated (the storage-service singleton reads env.UPLOAD_*_DIR at
// construction, which happens when a test lazily imports @/app).
process.env.UPLOAD_PUBLIC_DIR = services.uploadPublicDir;
process.env.UPLOAD_PRIVATE_DIR = services.uploadPrivateDir;

/** The prepared services (addresses and upload folders) for tests that need them directly. */
export const integrationServices = services;
