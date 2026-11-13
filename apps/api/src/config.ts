import { z } from 'zod';

const envSchema = z
  .object({
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    HOST: z.string().min(1).default('0.0.0.0'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.string().min(1),
    /**
     * Cómo se identifica a quien hace la petición. `jwt`: token de acceso (F1, ADR-0013). `header`: las
     * cabeceras `X-Tenant-Id`/`X-Bidder-Id`, que cualquiera puede falsificar y por eso están prohibidas
     * en producción. Por defecto, `jwt` en producción y `header` fuera de ella.
     */
    AUTH_MODE: z.enum(['header', 'jwt']).optional(),
    /** Peticiones por minuto y por IP a `/v1/auth/*` (red de seguridad contra fuerza bruta). */
    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),
    /** Primer administrador de un tenant (se crea al arrancar si aún no hay ninguno): los tres o ninguno. */
    BOOTSTRAP_ADMIN_TENANT_ID: z.uuid().optional(),
    BOOTSTRAP_ADMIN_EMAIL: z.email().optional(),
    BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).max(128).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.AUTH_MODE === 'header') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message:
          'las cabeceras X-Tenant-Id/X-Bidder-Id no pueden usarse en producción: use AUTH_MODE=jwt (ADR-0013)',
      });
    }
    const bootstrap = [
      env.BOOTSTRAP_ADMIN_TENANT_ID,
      env.BOOTSTRAP_ADMIN_EMAIL,
      env.BOOTSTRAP_ADMIN_PASSWORD,
    ];
    if (bootstrap.some((v) => v !== undefined) && bootstrap.some((v) => v === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['BOOTSTRAP_ADMIN_EMAIL'],
        message:
          'BOOTSTRAP_ADMIN_TENANT_ID, BOOTSTRAP_ADMIN_EMAIL y BOOTSTRAP_ADMIN_PASSWORD van juntos',
      });
    }
  })
  .transform((env) => ({
    ...env,
    AUTH_MODE:
      env.AUTH_MODE ?? (env.NODE_ENV === 'production' ? ('jwt' as const) : ('header' as const)),
  }));

export type Config = z.infer<typeof envSchema>;

/** Valida el entorno al arrancar: si falta o sobra algo, falla ahí y no en medio de una petición. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  return envSchema.parse(env);
}
