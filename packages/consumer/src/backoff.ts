export interface RetryPolicy {
  /** Reintentos tras el primer intento: 3 → hasta 4 intentos en total (spec §5). */
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly factor: number;
  readonly capMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 200,
  factor: 2,
  capMs: 5_000,
};

/**
 * Espera antes del reintento número `retry` (1 = primer reintento): backoff exponencial con jitter
 * completo, `random() * min(cap, base · factor^(retry-1))`. `random` se inyecta para probarlo.
 */
export function backoffDelay(
  retry: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(policy.capMs, policy.baseDelayMs * policy.factor ** (retry - 1));
  return Math.round(random() * ceiling);
}
