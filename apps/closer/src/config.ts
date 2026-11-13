import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  /** Cada cuánto busca lotes y subastas vencidos (SDD D8 §7.1). */
  CLOSER_POLL_MS: z.coerce.number().int().min(100).default(5_000),
  /** Máximo de lotes (y de subastas) que atiende por ronda. */
  CLOSER_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(100),
  /** Las claves de idempotencia (C4) más antiguas que esto se borran (24 h). */
  IDEMPOTENCY_RETENTION_MS: z.coerce.number().int().min(60_000).default(86_400_000),
});

export type CloserConfig = z.infer<typeof envSchema>;

export function loadCloserConfig(env: Readonly<Record<string, string | undefined>>): CloserConfig {
  return envSchema.parse(env);
}
