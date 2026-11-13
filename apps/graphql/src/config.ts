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
     * Cómo se identifica al cliente: `jwt` (token de acceso de F1, ADR-0013) o `header` (`X-Tenant-Id`, que
     * cualquiera puede falsificar y por eso está prohibido en producción). Por defecto, `jwt` en
     * producción y `header` fuera de ella.
     */
    AUTH_MODE: z.enum(['header', 'jwt']).optional(),
    /**
     * Orígenes que pueden llamar a GraphQL desde un navegador (CORS), separados por comas. Vacío (por
     * defecto): ninguno. Origen exacto (`https://app.ejemplo.com`); `*` no se admite.
     */
    CORS_ALLOWED_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin !== ''),
      )
      .refine((origins) => origins.every((o) => /^https?:\/\/[^/*\s]+$/.test(o)), {
        message:
          'CORS_ALLOWED_ORIGINS solo admite orígenes exactos (https://host[:puerto]); no `*` ni rutas',
      }),
    /** Tope de `first` en las listas paginadas. */
    GQL_MAX_PAGE_SIZE: z.coerce.number().int().min(1).max(1_000).default(100),
    /** Límites de abuso (docs/sdd/E2/SDD.md §2.2). */
    GQL_MAX_DEPTH: z.coerce.number().int().min(1).max(50).default(7),
    GQL_MAX_COMPLEXITY: z.coerce.number().int().min(1).default(1_000),
    GQL_MAX_ALIASES: z.coerce.number().int().min(1).default(15),
    GQL_MAX_TOKENS: z.coerce.number().int().min(50).default(2_000),
    GQL_MAX_BODY_BYTES: z.coerce.number().int().min(1_024).default(102_400),
    /** Subscriptions (E3): cupo por tenant y cola por suscriptor. */
    GQL_MAX_SUBSCRIPTIONS_PER_TENANT: z.coerce.number().int().min(1).default(500),
    GQL_SUBSCRIPTION_QUEUE: z.coerce.number().int().min(1).default(50),
    /** Por defecto activa, salvo en producción. */
    GQL_INTROSPECTION: z.enum(['true', 'false']).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.AUTH_MODE === 'header') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message:
          'el tenant por cabecera (X-Tenant-Id) no puede usarse en producción: use AUTH_MODE=jwt (ADR-0013)',
      });
    }
  })
  .transform((env) => ({
    ...env,
    AUTH_MODE:
      env.AUTH_MODE ?? (env.NODE_ENV === 'production' ? ('jwt' as const) : ('header' as const)),
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
