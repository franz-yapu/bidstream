import { tryAcquireLeadership as acquire, type Leadership } from '@bidstream/db';

export type { Leadership };

/** Clave del bloqueo asesor de PostgreSQL que identifica al relay activo (constante arbitraria). */
export const RELAY_LOCK_KEY = '7266451001';

/** Intenta ser el relay activo (ver `tryAcquireLeadership` de `@bidstream/db`). */
export function tryAcquireLeadership(
  connectionString: string,
  key: string = RELAY_LOCK_KEY,
): Promise<Leadership | null> {
  return acquire(connectionString, key);
}
