import type { EventDraft } from '../draft.js';
import { parseMoney, type Money } from '../money.js';

export interface LotState {
  readonly lotId: string;
  readonly auctionId: string;
  readonly currency: string;
  readonly startingPrice: Money;
  readonly minIncrement: Money;
  readonly closesAt: Date;
  readonly status: 'open' | 'closed';
  /** Mejor puja vigente; `null` si todavía no hay pujas. */
  readonly currentPrice: Money | null;
  readonly currentBidderId: string | null;
  /** Solo con el lote cerrado y adjudicado. */
  readonly winnerId: string | null;
  readonly finalAmount: Money | null;
}

/**
 * Aplica un evento ya ocurrido al estado. El estado inicial es `undefined` y nace con
 * `LotPublished`. El proyector y las pruebas de reproceso usan esta misma función.
 */
export function evolveLot(state: LotState | undefined, event: EventDraft): LotState | undefined {
  if (event.type === 'LotPublished') {
    if (state !== undefined) return state;
    const p = event.payload;
    return {
      lotId: p.lotId,
      auctionId: p.auctionId,
      currency: p.currency,
      startingPrice: parseMoney(p.startingPrice),
      minIncrement: parseMoney(p.minIncrement),
      closesAt: new Date(p.closesAt),
      status: 'open',
      currentPrice: null,
      currentBidderId: null,
      winnerId: null,
      finalAmount: null,
    };
  }
  if (state === undefined) return undefined;
  switch (event.type) {
    case 'BidPlaced':
      return {
        ...state,
        currentPrice: parseMoney(event.payload.amount),
        currentBidderId: event.payload.bidderId,
      };
    case 'LotExtended':
      return { ...state, closesAt: new Date(event.payload.newClosesAt) };
    case 'LotClosed':
      return {
        ...state,
        status: 'closed',
        winnerId: event.payload.winnerId,
        finalAmount:
          event.payload.finalAmount === null ? null : parseMoney(event.payload.finalAmount),
      };
    case 'AuctionOpened':
    case 'AuctionClosed':
    case 'BidRejected':
      return state;
  }
}

/** Pliega una secuencia de eventos sobre un estado inicial. */
export function foldLot(events: readonly EventDraft[]): LotState | undefined {
  return events.reduce<LotState | undefined>((state, e) => evolveLot(state, e), undefined);
}
