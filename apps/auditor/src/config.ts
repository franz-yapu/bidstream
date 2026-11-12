import { z } from 'zod';

const envSchema = z.object({ DATABASE_URL: z.string().min(1) });
export type AuditorConfig = z.infer<typeof envSchema>;

export function loadAuditorConfig(
  env: Readonly<Record<string, string | undefined>>,
): AuditorConfig {
  return envSchema.parse(env);
}
