import type { Auction, Lot, PrismaClient } from '@bidstream/db';
import type { NotificationBus } from '@bidstream/notifier';
import DataLoader from 'dataloader';
import type { SubscriptionRegistry } from './subscriptions/registry.js';

/** Solo lecturas sobre la proyección. */
export type ReadDb = Pick<PrismaClient, 'auction' | 'lot' | 'bid'>;

export interface Loaders {
  readonly auctionById: DataLoader<string, Auction | null>;
  /** Lotes de una subasta por orden de cierre; el resolver aplica `first`. */
  readonly lotsByAuction: DataLoader<string, Lot[]>;
}

export interface GraphQLContext {
  readonly tenantId: string;
  readonly db: ReadDb;
  readonly loaders: Loaders;
  readonly maxPageSize: number;
  readonly bus: NotificationBus;
  readonly subscriptions: SubscriptionRegistry;
  readonly maxSubscriptionsPerTenant: number;
  readonly subscriptionQueue: number;
}

/**
 * Cargadores por petición: una consulta anidada hace **una** lectura por nivel, no una por elemento
 * (problema N+1). Todos filtran por tenant.
 */
export function createLoaders(db: ReadDb, tenantId: string): Loaders {
  return {
    auctionById: new DataLoader<string, Auction | null>(async (ids) => {
      const rows = await db.auction.findMany({ where: { id: { in: [...ids] }, tenantId } });
      const byId = new Map(rows.map((r) => [r.id, r]));
      return ids.map((id) => byId.get(id) ?? null);
    }),
    lotsByAuction: new DataLoader<string, Lot[]>(async (ids) => {
      const rows = await db.lot.findMany({
        where: { auctionId: { in: [...ids] }, tenantId },
        orderBy: [{ closesAt: 'asc' }, { id: 'asc' }],
      });
      const byAuction = new Map<string, Lot[]>();
      for (const row of rows)
        byAuction.set(row.auctionId, [...(byAuction.get(row.auctionId) ?? []), row]);
      return ids.map((id) => byAuction.get(id) ?? []);
    }),
  };
}
