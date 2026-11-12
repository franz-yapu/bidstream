import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof envSchema>;

/** Valida el entorno al arrancar: si falta o sobra algo, falla ahí y no en medio de una petición. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  return envSchema.parse(env);
}
