import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  RELAY_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(100),
  RELAY_POLL_MS: z.coerce.number().int().min(10).default(200),
  RELAY_STANDBY_POLL_MS: z.coerce.number().int().min(100).default(5_000),
});

export type RelayConfig = z.infer<typeof envSchema>;

export function loadRelayConfig(env: Readonly<Record<string, string | undefined>>): RelayConfig {
  return envSchema.parse(env);
}
