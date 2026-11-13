import type { Bid, Lot } from '@bidstream/db';
import type { GraphQLContext } from './context.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import { badInput } from './errors.js';

/** Valida `first` contra el tope configurado: fuera de rango se rechaza, no se recorta en silencio. */
export function checkPageSize(first: number, max: number): number {
  if (!Number.isInteger(first) || first < 1 || first > max) {
    throw badInput(`first debe estar entre 1 y ${String(max)}`);
  }
  return first;
}

export async function findLot(ctx: GraphQLContext, lotId: string): Promise<Lot | null> {
  return ctx.db.lot.findFirst({ where: { id: lotId, tenantId: ctx.tenantId } });
}

export async function findActiveLots(
  ctx: GraphQLContext,
  auctionId: string,
  first: number,
): Promise<Lot[]> {
  return ctx.db.lot.findMany({
    where: { auctionId, tenantId: ctx.tenantId, status: 'OPEN' },
    orderBy: [{ closesAt: 'asc' }, { id: 'asc' }],
    take: checkPageSize(first, ctx.maxPageSize),
  });
}

export interface RankedBid extends Bid {
  readonly rank: number;
}

export interface BidConnectionData {
  readonly edges: readonly { readonly cursor: string; readonly node: RankedBid }[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
}

const EMPTY: BidConnectionData = { edges: [], pageInfo: { hasNextPage: false, endCursor: null } };

/**
 * Página del ranking de pujas de un lote. Paginación *keyset* sobre `(amount DESC, placedAt, id)`
 * (el índice `bid_ranking_idx`): estable ante inserciones y sin `OFFSET`. Un lote de otro tenant o
 * inexistente devuelve una conexión vacía, para no revelar su existencia.
 */
export async function findLotBids(
  ctx: GraphQLContext,
  lotId: string,
  first: number,
  after: string | null | undefined,
): Promise<BidConnectionData> {
  const size = checkPageSize(first, ctx.maxPageSize);
  const cursor = after === null || after === undefined ? null : decodeCursor(after);

  const lot = await ctx.db.lot.findFirst({
    where: { id: lotId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (lot === null) return EMPTY;

  const rows = await ctx.db.bid.findMany({
    where: cursor === null ? { lotId } : { lotId, OR: after_(cursor) },
    orderBy: [{ amount: 'desc' }, { placedAt: 'asc' }, { id: 'asc' }],
    take: size + 1,
  });

  // Posición de la primera fila de la página: cuántas pujas la preceden en el ranking.
  const ahead =
    cursor === null
      ? 0
      : await ctx.db.bid.count({
          where: {
            lotId,
            OR: [
              { amount: { gt: cursor.amount } },
              { amount: cursor.amount, placedAt: { lt: cursor.placedAt } },
              { amount: cursor.amount, placedAt: cursor.placedAt, id: { lte: cursor.id } },
            ],
          },
        });

  const page = rows.slice(0, size);
  const edges = page.map((bid, index) => ({
    cursor: encodeCursor({ amount: bid.amount.toFixed(2), placedAt: bid.placedAt, id: bid.id }),
    node: { ...bid, rank: ahead + index + 1 },
  }));
  return {
    edges,
    pageInfo: { hasNextPage: rows.length > size, endCursor: edges.at(-1)?.cursor ?? null },
  };
}

/** Condición «después de este cursor» en el orden del ranking. */
function after_(cursor: { amount: string; placedAt: Date; id: string }): object[] {
  return [
    { amount: { lt: cursor.amount } },
    { amount: cursor.amount, placedAt: { gt: cursor.placedAt } },
    { amount: cursor.amount, placedAt: cursor.placedAt, id: { gt: cursor.id } },
  ];
}
