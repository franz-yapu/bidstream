import type { DbClient } from '../repositories/transaction.js';

export interface DueLot {
  readonly lotId: string;
  readonly tenantId: string;
  readonly closesAt: Date;
}

export interface DueAuction {
  readonly auctionId: string;
  readonly tenantId: string;
}

/**
 * Consultas del `closer` (D8) sobre la **proyección**. Su desfase solo causa señales de más o tarde:
 * el cierre lo decide el decisor con su propio estado.
 */
export class PrismaClosingQueries {
  constructor(private readonly db: DbClient) {}

  /** Lotes abiertos cuyo `closes_at` ya pasó, los más antiguos primero. */
  async findDueLots(now: Date, limit: number): Promise<DueLot[]> {
    const rows = await this.db.$queryRaw<{ id: string; tenant_id: string; closes_at: Date }[]>`
      SELECT id, tenant_id, closes_at
      FROM lot
      WHERE status = 'OPEN'::lot_status AND closes_at <= ${now}
      ORDER BY closes_at, id
      LIMIT ${limit}`;
    return rows.map((r) => ({ lotId: r.id, tenantId: r.tenant_id, closesAt: r.closes_at }));
  }

  /** Subastas abiertas cuyo `closes_at` ya pasó y que ya no tienen lotes abiertos. */
  async findDueAuctions(now: Date, limit: number): Promise<DueAuction[]> {
    const rows = await this.db.$queryRaw<{ id: string; tenant_id: string }[]>`
      SELECT a.id, a.tenant_id
      FROM auction a
      WHERE a.status = 'OPEN'::auction_status
        AND a.closes_at <= ${now}
        AND NOT EXISTS (
          SELECT 1 FROM lot l WHERE l.auction_id = a.id AND l.status = 'OPEN'::lot_status
        )
      ORDER BY a.closes_at, a.id
      LIMIT ${limit}`;
    return rows.map((r) => ({ auctionId: r.id, tenantId: r.tenant_id }));
  }
}
