import { z } from 'zod';

const envSchema = z.object({ DATABASE_URL: z.string().min(1) });
export type ProjectorConfig = z.infer<typeof envSchema>;

export function loadProjectorConfig(
  env: Readonly<Record<string, string | undefined>>,
): ProjectorConfig {
  return envSchema.parse(env);
}
