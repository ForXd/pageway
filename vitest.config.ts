import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.{ts,tsx}',
      'apps/server/**/*.test.ts',
      'scripts/**/*.test.{ts,mjs}',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    testTimeout: 10000,
    hookTimeout: 15000,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**/*.{ts,tsx}', 'apps/server/src/app.ts'],
      exclude: [
        '**/*.test.{ts,tsx}',
        'packages/protocol/src/index.ts',
        'packages/react/src/index.ts',
        '**/types.ts',
      ],
      thresholds: { lines: 85, statements: 85, functions: 85, branches: 75 },
    },
  },
});
