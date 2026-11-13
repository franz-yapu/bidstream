import { createHash } from 'node:crypto';
import type { DbClient } from '../repositories/transaction.js';

/** Hash canónico de una petición: no depende del orden de las claves del objeto. */
export function requestHash(request: Readonly<Record<string, string>>): string {
  const canonical = JSON.stringify(
    Object.entries(request).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return createHash('sha256').update(canonical).digest('hex');
}

export interface IdempotencyClaim {
  readonly tenantId: string;
  readonly bidderId: string;
  readonly key: string;
  readonly requestHash: string;
  readonly commandId: string;
  readonly lotId: string;
  /** Instante de la petición (el reloj de la aplicación): la ventana del límite por minuto se mide con él. */
  readonly at?: Date;
}

export type ClaimResult =
  /** La clave era nueva: el comando es el de esta petición. */
  | { readonly status: 'claimed' }
  /** Ya existía con la misma petición: se devuelve el comando original. */
  | { readonly status: 'replayed'; readonly commandId: string }
  /** Ya existía con otra petición: error del cliente. */
  | { readonly status: 'conflict' };

/**
 * Claves de idempotencia de la puja (C4). Se usa dentro de la **misma transacción** que escribe el
 * comando en el outbox: o quedan las dos cosas o ninguna. Dos peticiones simultáneas con la misma
 * clave se resuelven por la clave primaria: la segunda espera, no inserta y relee la fila ganadora.
 */
export class PrismaIdempotencyStore {
  constructor(private readonly db: DbClient) {}

  async claim(claim: IdempotencyClaim): Promise<ClaimResult> {
    // INSERT … ON CONFLICT DO NOTHING: un INSERT duplicado abortaría la transacción de PostgreSQL.
    const { count } = await this.db.idempotencyKey.createMany({
      data: [
        {
          tenantId: claim.tenantId,
          bidderId: claim.bidderId,
          key: claim.key,
          requestHash: claim.requestHash,
          commandId: claim.commandId,
          lotId: claim.lotId,
          ...(claim.at === undefined ? {} : { createdAt: claim.at }),
        },
      ],
      skipDuplicates: true,
    });
    if (count === 1) return { status: 'claimed' };
    const existing = await this.db.idempotencyKey.findUniqueOrThrow({
      where: {
        tenantId_bidderId_key: {
          tenantId: claim.tenantId,
          bidderId: claim.bidderId,
          key: claim.key,
        },
      },
    });
    return existing.requestHash === claim.requestHash
      ? { status: 'replayed', commandId: existing.commandId }
      : { status: 'conflict' };
  }

  /**
   * Serializa las pujas de un mismo postor durante la transacción en curso (bloqueo asesor de
   * transacción): sin él, una ráfaga simultánea contaría las mismas filas y superaría el límite.
   */
  async lockBidder(tenantId: string, bidderId: string): Promise<void> {
    // `pg_advisory_xact_lock` devuelve `void`, que Prisma no sabe leer: se envuelve en una columna entera.
    await this.db.$queryRaw`SELECT 1 AS locked FROM (
      SELECT pg_advisory_xact_lock(hashtextextended(${`bidder:${tenantId}:${bidderId}`}, 0))
    ) AS l`;
  }

  /** La puja más antigua del postor desde `since`, para calcular cuándo vuelve a tener cupo. */
  async oldestSince(tenantId: string, bidderId: string, since: Date): Promise<Date | null> {
    const row = await this.db.idempotencyKey.findFirst({
      where: { tenantId, bidderId, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    return row?.createdAt ?? null;
  }

  /** Pujas aceptadas por el postor desde `since` (el límite por minuto, F2). */
  countSince(tenantId: string, bidderId: string, since: Date): Promise<number> {
    return this.db.idempotencyKey.count({
      where: { tenantId, bidderId, createdAt: { gte: since } },
    });
  }

  /** Borra las claves anteriores a `before`; devuelve cuántas. Lo ejecutará el `closer` (D8). */
  async deleteOlderThan(before: Date): Promise<number> {
    const { count } = await this.db.idempotencyKey.deleteMany({
      where: { createdAt: { lt: before } },
    });
    return count;
  }
}
