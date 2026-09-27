import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration tests share one local database.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
