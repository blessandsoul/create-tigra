import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * Integration test config — REAL MySQL 8 + Redis, app.inject().
 *
 * Deliberately SEPARATE from the Docker-free unit `vitest.config.ts`:
 *   - includes ONLY `*.integration.test.ts`
 *   - `globalSetup` prepares MySQL and Redis ONCE per run (Testcontainers, or
 *     existing services named by INTEGRATION_DATABASE_URL and
 *     INTEGRATION_REDIS_URL) and applies prisma/migrations; see
 *     src/test/integration.global-setup.ts and docs/testing.md
 *   - `setupFiles` points each test file's env at them (integration.setup.ts),
 *     NOT the mocking unit setup `src/test/setup.ts`
 *   - files run one after another: they share one database and Redis
 *   - generous timeouts: container boot + migrations are slow on a cold
 *     Docker daemon / first image pull.
 *
 * Run with: npm run test:integration
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./src/test/integration.global-setup.ts'],
    setupFiles: ['./src/test/integration.setup.ts'],
    include: ['**/*.integration.test.ts'],
    exclude: ['node_modules', 'dist'],
    // One file at a time: every file uses the same database and Redis (counts,
    // limiter keys and IP block lists would otherwise cross between files).
    // Each file still gets its own process and fresh modules, so a file can
    // change the env (for example switch rate limits on) before importing the
    // app. (A `singleFork` option sat here before; Vitest 4 has no such option,
    // so it did nothing.)
    pool: 'forks',
    fileParallelism: false,
    // Container boot + image pull + migrations can take well over a minute on a
    // cold daemon; globalSetup does that once, before the first file.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    teardownTimeout: 60_000,
    // No coverage gate on the integration suite — coverage thresholds live in
    // the unit config. This suite is about real end-to-end behavior.
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@modules': resolve(__dirname, './src/modules'),
      '@libs': resolve(__dirname, './src/libs'),
      '@config': resolve(__dirname, './src/config'),
      '@shared': resolve(__dirname, './src/shared'),
      '@jobs': resolve(__dirname, './src/jobs'),
    },
  },
});
