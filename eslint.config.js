import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const infraImports = [
  '@prisma/client',
  'prisma',
  'kafkajs',
  '@confluentinc/*',
  'fastify',
  'express',
  'graphql',
  'graphql-*',
  'pg',
  'node:fs',
  'node:net',
  'node:http',
  'node:https',
  '**/apps/**',
  '@bidstream/db',
  '@bidstream/kafka',
  '@bidstream/consumer',
  '@bidstream/testing',
];

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/generated/**',
      '**/coverage/**',
      'node_modules/**',
      'docs/**',
      'apps/web/public/**',
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  { files: ['**/*.js'], extends: [tseslint.configs.disableTypeChecked] },
  {
    // El código de prueba (@bidstream/testing) solo se importa desde pruebas.
    files: ['**/*.ts'],
    ignores: ['**/*.test.ts', 'packages/testing/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@bidstream/testing'],
              message: '@bidstream/testing solo puede importarse desde archivos *.test.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    // El dominio no depende de infraestructura (docs/do-not-touch.md).
    files: ['packages/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: infraImports,
              message:
                'packages/domain no puede importar infraestructura (ver docs/do-not-touch.md).',
            },
          ],
        },
      ],
    },
  },
  {
    // El front (J1) es código de navegador: hooks de React y sin acceso a paquetes de servidor.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@bidstream/*', 'node:*', 'pg', 'kafkajs', '@confluentinc/*', 'fastify'],
              message: 'apps/web es código de navegador: no importa paquetes de servidor.',
            },
          ],
        },
      ],
      // los componentes de React no devuelven promesas en los manejadores de eventos
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
);
