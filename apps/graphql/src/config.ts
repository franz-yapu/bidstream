import { z } from 'zod';

const envSchema = z
  .object({
    GRAPHQL_PORT: z.coerce.number().int().min(0).max(65535).default(4000),
    HOST: z.string().min(1).default('0.0.0.0'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.string().min(1),
    /**
     * Cómo se obtiene el tenant. Hasta que F1 aporte autenticación solo existe `header`
     * (`X-Tenant-Id`), que cualquiera puede falsificar: por eso está prohibido en producción.
     */
    TENANT_MODE: z.enum(['header']).default('header'),
    /** Tope de `first` en las listas paginadas. */
    GQL_MAX_PAGE_SIZE: z.coerce.number().int().min(1).max(1_000).default(100),
    /** Límites de abuso (docs/sdd/E2/SDD.md §2.2). */
    GQL_MAX_DEPTH: z.coerce.number().int().min(1).max(50).default(7),
    GQL_MAX_COMPLEXITY: z.coerce.number().int().min(1).default(1_000),
    GQL_MAX_ALIASES: z.coerce.number().int().min(1).default(15),
    GQL_MAX_TOKENS: z.coerce.number().int().min(50).default(2_000),
    GQL_MAX_BODY_BYTES: z.coerce.number().int().min(1_024).default(102_400),
    /** Por defecto activa, salvo en producción. */
    GQL_INTROSPECTION: z.enum(['true', 'false']).optional(),
  })
  .superRefine((env, ctx) => {
    // Hoy el único modo es `header`; cuando F1 añada otro, la condición pasará a comprobar el modo.
    if (env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['TENANT_MODE'],
        message:
          'el tenant por cabecera (X-Tenant-Id) no puede usarse en producción: requiere autenticación (F1)',
      });
    }
  })
  .transform((env) => ({
    ...env,
    GQL_INTROSPECTION:
      env.GQL_INTROSPECTION === undefined
        ? env.NODE_ENV !== 'production'
        : env.GQL_INTROSPECTION === 'true',
  }));

export type Config = z.output<typeof envSchema>;

/** Valida el entorno al arrancar: si falta o sobra algo, falla ahí y no en medio de una petición. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  return envSchema.parse(env);
}
