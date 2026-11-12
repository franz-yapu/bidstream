import pg from 'pg';

/** Clave del bloqueo asesor de PostgreSQL que identifica al relay activo (constante arbitraria). */
export const RELAY_LOCK_KEY = '7266451001';

export interface Leadership {
  /** `true` si la conexión que sostiene el bloqueo se perdió: ya no somos el líder. */
  readonly lost: boolean;
  release(): Promise<void>;
}

/**
 * Intenta ser el relay activo. El bloqueo asesor es de **sesión**: se sostiene mientras viva esta
 * conexión dedicada (no el pool de Prisma, que podría reciclarla) y se libera solo si el proceso
 * cae. Devuelve `null` si otro proceso ya es el líder.
 */
export async function tryAcquireLeadership(
  connectionString: string,
  key: string = RELAY_LOCK_KEY,
): Promise<Leadership | null> {
  const client = new pg.Client({ connectionString });
  let lost = false;
  client.on('error', () => {
    lost = true;
  });
  client.on('end', () => {
    lost = true;
  });
  await client.connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>(
      'SELECT pg_try_advisory_lock($1::bigint) AS ok',
      [key],
    );
    if (rows[0]?.ok !== true) {
      await client.end();
      return null;
    }
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }
  return {
    get lost() {
      return lost;
    },
    release: async () => {
      if (!lost) {
        await client.query('SELECT pg_advisory_unlock($1::bigint)', [key]).catch(() => undefined);
      }
      await client.end().catch(() => undefined);
    },
  };
}
