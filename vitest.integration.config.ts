import { defineConfig } from 'vitest/config';

// Pruebas de integración contra PostgreSQL y Kafka reales (`make up`).
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.int.test.ts', 'apps/*/src/**/*.int.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
