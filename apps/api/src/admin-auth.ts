import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compara la clave de servicio en tiempo constante. Se comparan los *hashes* SHA-256, que tienen
 * siempre la misma longitud: así tampoco se filtra la longitud de la clave real.
 */
export function adminKeyMatches(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
