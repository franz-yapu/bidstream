import { formatMoney, minimumBid, primitives } from '@bidstream/domain';
import { toLotState, type Auction, type Lot } from '@bidstream/db';
import { GraphQLScalarType } from 'graphql';
import type { GraphQLContext } from './context.js';
import { checkPageSize, findActiveLots, findLot, findLotBids, type RankedBid } from './data.js';
import { badInput } from './errors.js';

const MONEY = /^\d+\.\d{2}$/;

const Money = new GraphQLScalarType<string, string>({
  name: 'Money',
  serialize(value) {
    if (typeof value !== 'string' || !MONEY.test(value))
      throw new TypeError('Money debe ser una cadena decimal con dos decimales');
    return value;
  },
});

const DateTime = new GraphQLScalarType<Date, string>({
  name: 'DateTime',
  serialize(value) {
    if (value instanceof Date) return value.toISOString();
    throw new TypeError('DateTime debe ser una fecha');
  },
});

/** Un `ID` que no es UUID no puede existir: se rechaza antes de tocar la base de datos. */
function uuid(value: string): string {
  if (!primitives.uuid.safeParse(value).success)
    throw badInput('el identificador debe ser un UUID');
  return value;
}

const money = (value: { toFixed(decimals: number): string }): string => value.toFixed(2);

export const resolvers = {
  Money,
  DateTime,
  Query: {
    auction: (_: unknown, args: { id: string }, ctx: GraphQLContext) =>
      ctx.loaders.auctionById.load(uuid(args.id)),
    lot: (_: unknown, args: { id: string }, ctx: GraphQLContext) => findLot(ctx, uuid(args.id)),
    lotBids: (
      _: unknown,
      args: { lotId: string; first: number; after?: string | null },
      ctx: GraphQLContext,
    ) => findLotBids(ctx, uuid(args.lotId), args.first, args.after),
    activeLots: (_: unknown, args: { auctionId: string; first: number }, ctx: GraphQLContext) =>
      findActiveLots(ctx, uuid(args.auctionId), args.first),
  },
  Auction: {
    lots: async (auction: Auction, args: { first: number }, ctx: GraphQLContext) => {
      const size = checkPageSize(args.first, ctx.maxPageSize);
      return (await ctx.loaders.lotsByAuction.load(auction.id)).slice(0, size);
    },
  },
  Lot: {
    auction: (lot: Lot, _: unknown, ctx: GraphQLContext) =>
      ctx.loaders.auctionById.load(lot.auctionId),
    startingPrice: (lot: Lot) => money(lot.startingPrice),
    minIncrement: (lot: Lot) => money(lot.minIncrement),
    currentPrice: (lot: Lot) => (lot.currentPrice === null ? null : money(lot.currentPrice)),
    hasWinner: (lot: Lot) => lot.winnerId !== null,
    finalAmount: (lot: Lot) =>
      lot.status === 'CLOSED' && lot.winnerId !== null && lot.currentPrice !== null
        ? money(lot.currentPrice)
        : null,
    nextMinimumBid: (lot: Lot) => formatMoney(minimumBid(toLotState(lot))),
    bids: (lot: Lot, args: { first: number; after?: string | null }, ctx: GraphQLContext) =>
      findLotBids(ctx, lot.id, args.first, args.after),
  },
  Bid: {
    amount: (bid: RankedBid) => money(bid.amount),
  },
};
