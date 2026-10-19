import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  // Promises that nobody awaits. An unhandled rejection ends the process with
  // exit code 1 (src/libs/shutdown.ts), so a forgotten `await` is a crash
  // waiting for its first error; an async function passed where a plain
  // callback is expected (a misused promise) loses its errors the same way.
  // Both rules need type information: projectService reads tsconfig.json, which
  // makes lint a little slower. Mark a deliberate fire-and-forget with `void`.
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'prisma/'],
  }
);
