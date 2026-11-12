import { describe, expect, it } from 'vitest';
import type { EventDraft } from '../draft.js';
import { decideCloseAuction, evolveAuction, type AuctionState } from './state.js';

const AUCTION = '22222222-2222-4222-8222-222222222222';
const OTHER = '99999999-9999-4999-8999-999999999999';
const L1 = '33333333-3333-4333-8333-333333333333';
const L2 = '66666666-6666-4666-8666-666666666666';
const T = '2026-11-12T20:00:00.000Z';

const opened: EventDraft = {
  type: 'AuctionOpened',
  payload: { auctionId: AUCTION, title: 'Arte', opensAt: '2026-11-12T10:00:00.000Z', closesAt: T },
};
const lotPublished = (lotId: string, auctionId = AUCTION): EventDraft => ({
  type: 'LotPublished',
  payload: {
    lotId,
    auctionId,
    title: 'x',
    startingPrice: '1.00',
    minIncrement: '1.00',
    currency: 'USD',
    closesAt: T,
  },
});
const lotClosed = (lotId: string): EventDraft => ({
  type: 'LotClosed',
  payload: { lotId, winnerId: null, finalAmount: null },
});

function fold(events: EventDraft[]): AuctionState {
  const state = events.reduce<AuctionState | undefined>((s, e) => evolveAuction(s, e), undefined);
  if (state === undefined) throw new Error('la subasta debería existir');
  return state;
}

describe('subasta', () => {
  it('no cierra mientras queden lotes abiertos', () => {
    expect(
      decideCloseAuction(fold([opened, lotPublished(L1), lotPublished(L2), lotClosed(L1)])),
    ).toEqual([]);
  });
  it('cierra cuando todos los lotes están cerrados', () => {
    const state = fold([opened, lotPublished(L1), lotPublished(L2), lotClosed(L1), lotClosed(L2)]);
    expect(decideCloseAuction(state)).toEqual([
      { type: 'AuctionClosed', payload: { auctionId: AUCTION } },
    ]);
  });
  it('no emite nada si ya está cerrada', () => {
    const closed = fold([opened, { type: 'AuctionClosed', payload: { auctionId: AUCTION } }]);
    expect(closed.status).toBe('closed');
    expect(decideCloseAuction(closed)).toEqual([]);
  });
  it('ignora lotes de otra subasta y eventos previos a abrir', () => {
    expect(evolveAuction(undefined, lotPublished(L1))).toBeUndefined();
    expect(fold([opened, lotPublished(L1, OTHER)]).openLotIds.size).toBe(0);
  });
  it('AuctionOpened repetido no reinicia el estado', () => {
    const state = fold([opened, lotPublished(L1)]);
    expect(evolveAuction(state, opened)).toBe(state);
  });
});
