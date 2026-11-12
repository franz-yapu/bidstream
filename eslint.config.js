import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
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
];

export default defineConfig(
  { ignores: ['**/dist/**', '**/coverage/**', 'node_modules/**', 'docs/**', 'scripts/**'] },
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
);
