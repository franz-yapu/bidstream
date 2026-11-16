import { describe, expect, it } from 'vitest';
import { applyLotUpdate } from './live';
import type { LotWithAuction } from './types';

const lot: LotWithAuction = {
  id: 'l1',
  title: 'Lote',
  currency: 'USD',
  startingPrice: '100.00',
  minIncrement: '5.00',
  currentPrice: '110.00',
  closesAt: '2030-01-01T10:00:00.000Z',
  status: 'OPEN',
  hasWinner: false,
  finalAmount: null,
  nextMinimumBid: '115.00',
  auction: { id: 'a1', title: 'Subasta' },
};
const base = { eventId: 'e', occurredAt: '2030-01-01T09:00:00.000Z' } as const;

describe('applyLotUpdate', () => {
  it('una puja nueva sube el precio y recalcula la puja mínima con céntimos exactos', () => {
    const { lot: next } = applyLotUpdate(lot, {
      __typename: 'BidPlacedUpdate',
      ...base,
      amount: '120.10',
      placedAt: base.occurredAt,
    });
    expect(next.currentPrice).toBe('120.10');
    expect(next.nextMinimumBid).toBe('125.10');
  });

  it('una actualización atrasada no hace retroceder el precio', () => {
    const { lot: next } = applyLotUpdate(lot, {
      __typename: 'BidPlacedUpdate',
      ...base,
      amount: '105.00',
      placedAt: base.occurredAt,
    });
    expect(next).toBe(lot);
  });

  it('la extensión mueve el cierre y el cierre fija el resultado', () => {
    expect(
      applyLotUpdate(lot, {
        __typename: 'LotExtendedUpdate',
        ...base,
        newClosesAt: '2030-01-01T10:02:00.000Z',
      }).lot.closesAt,
    ).toBe('2030-01-01T10:02:00.000Z');
    const closed = applyLotUpdate(lot, {
      __typename: 'LotClosedUpdate',
      ...base,
      finalAmount: '110.00',
      hasWinner: true,
    }).lot;
    expect(closed).toMatchObject({ status: 'CLOSED', hasWinner: true, finalAmount: '110.00' });
  });

  it('ResyncRequired pide volver a consultar sin tocar el lote', () => {
    const result = applyLotUpdate(lot, { __typename: 'ResyncRequired', message: 'x' });
    expect(result).toEqual({ lot, resync: true });
  });
});
