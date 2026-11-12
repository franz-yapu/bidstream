export interface BackoffPolicy {
  readonly baseMs: number;
  readonly capMs: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 1_000, capMs: 30_000 };

/**
 * Espera tras `failures` fallos seguidos: exponencial con tope y «jitter igual» (la mitad fija, la
 * otra mitad aleatoria), para no saturar a Kafka al reintentar ni sincronizar varios procesos.
 */
export function backoffDelay(
  failures: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(policy.capMs, policy.baseMs * 2 ** (failures - 1));
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}
