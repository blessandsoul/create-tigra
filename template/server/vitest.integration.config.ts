import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * Integration test config — REAL Testcontainers (MySQL 8 + Redis), app.inject().
 *
 * Deliberately SEPARATE from the Docker-free unit `vitest.config.ts`:
 *   - includes ONLY `*.integration.test.ts`
 *   - uses `src/test/integration.setup.ts` (boots containers) — NOT the mocking
 *     unit setup `src/test/setup.ts`
 *   - runs serially in a single fork: the containers are shared process-wide and
 *     started once via the setup file's top-level await, so parallel workers
 *     must not fight over them or each re-boot Docker.
 *   - generous timeouts: container boot + `prisma db push` is slow on a cold
 *     Docker daemon / first image pull.
 *
 * Run with: npm run test:integration
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/integration.setup.ts'],
    include: ['**/*.integration.test.ts'],
    exclude: ['node_modules', 'dist'],
    // Containers are shared — never parallelize across files or forks.
    // Vitest 4 flattened `poolOptions.forks.singleFork` to the top-level
    // `singleFork` option (the nested form is deprecated/removed).
    pool: 'forks',
    singleFork: true,
    fileParallelism: false,
    // Container boot + image pull + schema push can take well over a minute on
    // a cold daemon; the setup file does all of that under hookTimeout.
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
