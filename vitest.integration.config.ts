import { defineConfig } from 'vitest/config';

// Pruebas de integración contra PostgreSQL y Kafka reales (`make up`).
export default defineConfig({
  test: {
    // `graphql` existe como paquete ESM y CJS: si Yoga y nuestro código lo cargan por rutas distintas
    // son dos copias y `instanceof GraphQLError` falla. Se procesan juntos para usar una sola.
    server: { deps: { inline: [/graphql/, /@graphql-tools/, /@whatwg-node/, /@envelop/] } },
    include: ['packages/*/src/**/*.int.test.ts', 'apps/*/src/**/*.int.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
