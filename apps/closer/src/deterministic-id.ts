import { createHash } from 'node:crypto';

/**
 * UUID con forma de v7 derivado de un texto: el mismo `seed` da siempre el mismo id. Sirve para que
 * una señal repetida (p. ej. `CloseLot` de un lote y un `closesAt`) tenga un id estable y el outbox
 * la deduplique por clave primaria. No es ordenable por tiempo como un v7 real.
 */
export function deterministicUuidV7(seed: string): string {
  const bytes = createHash('sha256').update(seed).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // versión 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variante RFC 4122
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
