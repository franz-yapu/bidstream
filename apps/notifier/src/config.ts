import { z } from 'zod';

const envSchema = z.object({ DATABASE_URL: z.string().min(1) });
export type NotifierConfig = z.infer<typeof envSchema>;

export function loadNotifierConfig(
  env: Readonly<Record<string, string | undefined>>,
): NotifierConfig {
  return envSchema.parse(env);
}
