import { defineConfig } from 'vitest/config';

// Pruebas unitarias: rápidas y sin infraestructura. Las de integración (`*.int.test.ts`) van
// aparte (`npm run test:integration`) porque necesitan `make up`.
export default defineConfig({
  test: {
    // `graphql` existe como paquete ESM y CJS: se procesan juntos para tener una sola copia.
    server: { deps: { inline: [/graphql/, /@graphql-tools/, /@whatwg-node/, /@envelop/] } },
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.int.test.ts'],
  },
});
