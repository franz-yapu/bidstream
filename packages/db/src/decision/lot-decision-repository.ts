import { formatMoney, type LotState } from '@bidstream/domain';
import type { DbClient } from '../repositories/transaction.js';
import { toLotState } from '../repositories/mappers.js';

/** Convierte centavos al texto que acepta `Decimal(12,2)`. */
const toDecimal = (cents: bigint): string => formatMoney(cents);

/**
 * Estado autoritativo de cada lote para el decisor de pujas (ADR-0011). Siempre dentro de una
 * transacción: `findForUpdate` bloquea la fila hasta su final, así que dos decisiones del mismo lote
 * nunca se solapan aunque hubiera dos decisores durante un rebalanceo.
 */
export class PrismaLotDecisionRepository {
  constructor(private readonly db: DbClient) {}

  /** Lee y bloquea el estado del lote; `null` si el decisor aún no lo conoce. */
  async findForUpdate(tenantId: string, lotId: string): Promise<LotState | null> {
    await this.db
      .$queryRaw`SELECT 1 FROM lot_decision WHERE lot_id = ${lotId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
    const row = await this.db.lotDecision.findFirst({ where: { lotId, tenantId } });
    if (row === null) return null;
    return toLotState({
      id: row.lotId,
      auctionId: row.auctionId,
      tenantId: row.tenantId,
      title: '',
      startingPrice: row.startingPrice,
      minIncrement: row.minIncrement,
      currency: row.currency,
      closesAt: row.closesAt,
      currentPrice: row.currentPrice,
      currentBidder: row.currentBidder,
      status: row.status,
      winnerId: row.winnerId,
    });
  }

  /** Crea o reemplaza el estado del lote. */
  async save(tenantId: string, state: LotState): Promise<void> {
    const data = {
      tenantId,
      auctionId: state.auctionId,
      currency: state.currency,
      startingPrice: toDecimal(state.startingPrice),
      minIncrement: toDecimal(state.minIncrement),
      closesAt: state.closesAt,
      status: state.status === 'open' ? ('OPEN' as const) : ('CLOSED' as const),
      currentPrice: state.currentPrice === null ? null : toDecimal(state.currentPrice),
      currentBidder: state.currentBidderId,
      winnerId: state.winnerId,
    };
    await this.db.lotDecision.upsert({
      where: { lotId: state.lotId },
      create: { lotId: state.lotId, ...data },
      update: data,
    });
  }
}
