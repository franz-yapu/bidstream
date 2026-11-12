import type { EventDraft } from '../draft.js';
import { formatMoney, type Money } from '../money.js';
import type { LotState } from './state.js';

export interface Bid {
  readonly bidderId: string;
  readonly amount: Money;
  readonly placedAt: Date;
}

/** Valores de negocio (Q7): no hay valores por defecto a propósito. */
export interface AntiSnipingConfig {
  readonly windowMs: number;
  readonly extensionMs: number;
}

/**
 * Regla 1: sin pujas previas basta `amount >= startingPrice`; con pujas, `amount` debe ser al
 * menos `precio actual + minIncrement`.
 */
export function minimumBid(state: LotState): Money {
  return state.currentPrice === null
    ? state.startingPrice
    : state.currentPrice + state.minIncrement;
}

/**
 * Decide una puja. No lanza por reglas de negocio: el rechazo también es un evento (spec §3).
 * Resultados posibles: `[BidRejected]`, `[BidPlaced]` o `[BidPlaced, LotExtended]` (regla 3).
 * El orden de llegada lo impone la partición por `lotId` (ADR-0001): a igual monto, la segunda
 * puja ya no supera el precio vigente y se rechaza (regla 2).
 */
export function decideBid(state: LotState, bid: Bid, config: AntiSnipingConfig): EventDraft[] {
  const reject = (reason: 'LOT_CLOSED' | 'BID_TOO_LOW'): EventDraft[] => [
    {
      type: 'BidRejected',
      payload: {
        lotId: state.lotId,
        bidderId: bid.bidderId,
        amount: formatMoney(bid.amount),
        reason,
      },
    },
  ];

  if (state.status === 'closed' || bid.placedAt.getTime() >= state.closesAt.getTime()) {
    return reject('LOT_CLOSED');
  }
  if (bid.amount < minimumBid(state)) return reject('BID_TOO_LOW');

  const events: EventDraft[] = [
    {
      type: 'BidPlaced',
      payload: {
        lotId: state.lotId,
        bidderId: bid.bidderId,
        amount: formatMoney(bid.amount),
        placedAt: bid.placedAt.toISOString(),
      },
    },
  ];
  const remainingMs = state.closesAt.getTime() - bid.placedAt.getTime();
  if (config.extensionMs > 0 && remainingMs <= config.windowMs) {
    events.push({
      type: 'LotExtended',
      payload: {
        lotId: state.lotId,
        newClosesAt: new Date(state.closesAt.getTime() + config.extensionMs).toISOString(),
        reason: 'anti-sniping',
      },
    });
  }
  return events;
}

export interface RankedBid {
  readonly id: string;
  readonly amount: Money;
  readonly placedAt: Date;
}

/**
 * Regla 2 (desempate determinista), igual al índice `(lotId, amount DESC, placedAt, id)`:
 * negativo si `a` clasifica antes que `b`.
 */
export function compareBids(a: RankedBid, b: RankedBid): number {
  if (a.amount !== b.amount) return a.amount > b.amount ? -1 : 1;
  const byTime = a.placedAt.getTime() - b.placedAt.getTime();
  if (byTime !== 0) return byTime;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}
