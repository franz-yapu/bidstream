import { parseMoney, type AuctionState, type LotState, type Money } from '@bidstream/domain';
import type { Auction, Lot } from '../generated/client.js';

/** Un `Decimal` de Prisma a centavos, sin pasar nunca por `number` (business-rule #6). */
export function decimalToMoney(value: { toFixed(decimals: number): string }): Money {
  return parseMoney(value.toFixed(2));
}

/**
 * Fila de `lot` → `LotState`. `finalAmount` no tiene columna propia: es el precio vigente cuando
 * el lote se adjudicó (igual que lo reconstruye `evolveLot` con `LotClosed`).
 */
export function toLotState(row: Lot): LotState {
  const currentPrice = row.currentPrice === null ? null : decimalToMoney(row.currentPrice);
  return {
    lotId: row.id,
    auctionId: row.auctionId,
    currency: row.currency,
    startingPrice: decimalToMoney(row.startingPrice),
    minIncrement: decimalToMoney(row.minIncrement),
    closesAt: row.closesAt,
    status: row.status === 'OPEN' ? 'open' : 'closed',
    currentPrice,
    currentBidderId: row.currentBidder,
    winnerId: row.winnerId,
    finalAmount: row.status === 'CLOSED' && row.winnerId !== null ? currentPrice : null,
  };
}

/** Fila de `auction` + ids de sus lotes abiertos → `AuctionState`. */
export function toAuctionState(row: Auction, openLotIds: readonly string[]): AuctionState {
  return {
    auctionId: row.id,
    status: row.status === 'OPEN' ? 'open' : 'closed',
    openLotIds: new Set(openLotIds),
  };
}
