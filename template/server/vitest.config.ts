import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.config.ts',
        '**/*.config.js',
        '**/test/**',
        '**/__tests__/**',
        'prisma/**',
        'scripts/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
        // Money-path forward-contract: any future payments module is held to a
        // stricter bar than the 80% global gate. The scaffold ships no payments
        // module, so this glob matches nothing today and is vacuously satisfied;
        // the moment an app adds `src/modules/payments/**`, these thresholds
        // start enforcing. Verified to not red an empty match on vitest v4.
        'src/modules/payments/**': { lines: 95, branches: 90 },
      },
    },
    setupFiles: ['./src/test/setup.ts'],
    include: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
    // Keep the unit gate Docker-free: integration tests boot Testcontainers and
    // live behind `npm run test:integration` (vitest.integration.config.ts).
    // The `**/*.test.ts` include would otherwise sweep in `*.integration.test.ts`.
    exclude: ['node_modules', 'dist', '**/*.integration.test.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@modules': resolve(__dirname, './src/modules'),
      '@libs': resolve(__dirname, './src/libs'),
      '@config': resolve(__dirname, './src/config'),
      '@shared': resolve(__dirname, './src/shared'),
    },
  },
});
