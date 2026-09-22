import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Load .env.test before anything else so tests never touch the dev database.
    setupFiles: ['./tests/setup.js'],
    // Integration tests share one database, so run test files one at a time.
    fileParallelism: false,
    testTimeout: 20000,
    include: ['tests/**/*.test.js'],
  },
});
