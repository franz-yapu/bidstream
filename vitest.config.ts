import { defineConfig } from 'vitest/config';

// Pruebas unitarias: rápidas y sin infraestructura. Las de integración (`*.int.test.ts`) van
// aparte (`npm run test:integration`) porque necesitan `make up`.
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.int.test.ts'],
  },
});
