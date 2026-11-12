export interface WaitOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  /** Texto del error si se agota el tiempo. */
  readonly description?: string;
}

/** Espera a que `condition` se cumpla; lanza con un mensaje claro si se agota el tiempo. */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  { timeoutMs = 15_000, intervalMs = 50, description = 'la condición' }: WaitOptions = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() >= deadline) {
      throw new Error(`timeout de ${String(timeoutMs)} ms esperando ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
