import type { LotRepository } from '@bidstream/domain';
import type { LotState } from '@bidstream/domain';
import type { DbClient } from './transaction.js';
import { toLotState } from './mappers.js';

/** Lectura del estado de un lote desde la proyección; siempre filtra por tenant. */
export class PrismaLotRepository implements LotRepository {
  constructor(private readonly db: DbClient) {}

  async findById(tenantId: string, lotId: string): Promise<LotState | null> {
    const row = await this.db.lot.findFirst({ where: { id: lotId, tenantId } });
    return row === null ? null : toLotState(row);
  }
}
