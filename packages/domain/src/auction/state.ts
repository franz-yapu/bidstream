import type { EventDraft } from '../draft.js';

export interface AuctionState {
  readonly auctionId: string;
  readonly status: 'open' | 'closed';
  readonly openLotIds: ReadonlySet<string>;
}

/** Aplica un evento de la subasta o de uno de sus lotes. Estado inicial: `undefined`. */
export function evolveAuction(
  state: AuctionState | undefined,
  event: EventDraft,
): AuctionState | undefined {
  if (event.type === 'AuctionOpened') {
    return state ?? { auctionId: event.payload.auctionId, status: 'open', openLotIds: new Set() };
  }
  if (state === undefined) return undefined;
  switch (event.type) {
    case 'LotPublished':
      return event.payload.auctionId === state.auctionId
        ? { ...state, openLotIds: new Set([...state.openLotIds, event.payload.lotId]) }
        : state;
    case 'LotClosed':
      return {
        ...state,
        openLotIds: new Set([...state.openLotIds].filter((id) => id !== event.payload.lotId)),
      };
    case 'AuctionClosed':
      return event.payload.auctionId === state.auctionId ? { ...state, status: 'closed' } : state;
    case 'BidPlaced':
    case 'BidRejected':
    case 'LotExtended':
      return state;
  }
}

/** `AuctionClosed` solo si la subasta está abierta y no quedan lotes abiertos. */
export function decideCloseAuction(state: AuctionState): EventDraft[] {
  if (state.status === 'closed' || state.openLotIds.size > 0) return [];
  return [{ type: 'AuctionClosed', payload: { auctionId: state.auctionId } }];
}
