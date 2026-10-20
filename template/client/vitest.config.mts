import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the client's logic: the API client's session rules, the
 * proxy's CSP and redirects, redirect safety, error parsing and the store.
 * They run in Node; a file that needs `document` or `window` starts with
 * `// @vitest-environment jsdom`. Screens are not unit-tested here: the
 * template ships no pages, and the components are thin over these functions.
 *
 * Test files and this config are kept out of the production image
 * (.dockerignore), so the image's `next build` never type-checks them. The
 * .mts extension: this package is not `"type": "module"`, and Vite warns about
 * ESM syntax in a config it would load as CommonJS.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      // Every source file counts, also the ones no test loads, so the number
      // is honest. Type-only files and the tests themselves are left out.
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['**/__tests__/**', '**/*.test.ts', '**/*.d.ts', 'src/types/**'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
