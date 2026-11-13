import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  /**
   * Anti-sniping (regla 3): una puja a menos de `WINDOW` del cierre lo extiende `EXTENSION`.
   * El dominio no tiene valores por defecto a propósito; estos son los de la aplicación (SDD C3 §7.1).
   * `EXTENSION = 0` lo desactiva.
   */
  ANTI_SNIPING_WINDOW_MS: z.coerce.number().int().min(0).default(120_000),
  ANTI_SNIPING_EXTENSION_MS: z.coerce.number().int().min(0).default(120_000),
});

export type DeciderConfig = z.infer<typeof envSchema>;

export function loadDeciderConfig(
  env: Readonly<Record<string, string | undefined>>,
): DeciderConfig {
  return envSchema.parse(env);
}
