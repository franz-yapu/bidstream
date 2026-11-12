import type { AuctionRepository, AuctionState } from '@bidstream/domain';
import type { DbClient } from './transaction.js';
import { toAuctionState } from './mappers.js';

/** Lectura del estado de una subasta desde la proyección; siempre filtra por tenant. */
export class PrismaAuctionRepository implements AuctionRepository {
  constructor(private readonly db: DbClient) {}

  async findById(tenantId: string, auctionId: string): Promise<AuctionState | null> {
    const auction = await this.db.auction.findFirst({ where: { id: auctionId, tenantId } });
    if (auction === null) return null;
    const openLots = await this.db.lot.findMany({
      where: { auctionId, tenantId, status: 'OPEN' },
      select: { id: true },
    });
    return toAuctionState(
      auction,
      openLots.map((l) => l.id),
    );
  }
}
