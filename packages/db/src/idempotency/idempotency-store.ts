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

  /** Pujas aceptadas por el postor desde `since` (la usará el límite por minuto, F2). */
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
