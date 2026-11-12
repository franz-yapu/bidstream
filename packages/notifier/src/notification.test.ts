import { buildEvent, type DomainEvent } from '@bidstream/domain';
import { describe, expect, it } from 'vitest';
import { lotNotificationSchema, toLotNotification } from './notification.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ANA = '44444444-4444-4444-8444-444444444444';
const LOT = '33333333-3333-4333-8333-333333333333';
const AUCTION = '22222222-2222-4222-8222-222222222222';
const T = '2026-11-13T20:00:00.000Z';

const events: Record<DomainEvent['type'], DomainEvent> = {
  AuctionOpened: buildEvent('AuctionOpened', TENANT, {
    auctionId: AUCTION,
    title: 'Arte',
    opensAt: '2026-11-12T10:00:00.000Z',
    closesAt: T,
  }),
  LotPublished: buildEvent('LotPublished', TENANT, {
    lotId: LOT,
    auctionId: AUCTION,
    title: 'Óleo',
    startingPrice: '100.00',
    minIncrement: '5.00',
    currency: 'USD',
    closesAt: T,
  }),
  BidPlaced: buildEvent('BidPlaced', TENANT, {
    lotId: LOT,
    bidderId: ANA,
    amount: '105.50',
    placedAt: '2026-11-13T19:00:00.000Z',
  }),
  BidRejected: buildEvent('BidRejected', TENANT, {
    lotId: LOT,
    bidderId: ANA,
    amount: '1.00',
    reason: 'BID_TOO_LOW',
  }),
  LotExtended: buildEvent('LotExtended', TENANT, {
    lotId: LOT,
    newClosesAt: '2026-11-13T20:05:00.000Z',
    reason: 'anti-sniping',
  }),
  LotClosed: buildEvent('LotClosed', TENANT, { lotId: LOT, winnerId: ANA, finalAmount: '105.50' }),
  AuctionClosed: buildEvent('AuctionClosed', TENANT, { auctionId: AUCTION }),
};

describe('toLotNotification', () => {
  it.each(['LotPublished', 'BidPlaced', 'LotExtended', 'LotClosed'] as const)(
    '%s genera su notificación, válida y con los datos del evento',
    (type) => {
      const event = events[type];
      const n = toLotNotification(event);
      expect(n).not.toBeNull();
      expect(lotNotificationSchema.safeParse(n).success).toBe(true);
      expect(n).toMatchObject({
        type,
        eventId: event.eventId,
        occurredAt: event.occurredAt,
        tenantId: TENANT,
        lotId: LOT,
      });
    },
  );

  it.each(['AuctionOpened', 'AuctionClosed', 'BidRejected'] as const)(
    '%s no genera notificación de lote',
    (type) => {
      expect(toLotNotification(events[type])).toBeNull();
    },
  );

  it('los campos específicos de cada notificación son los del §2.2', () => {
    expect(toLotNotification(events.LotPublished)).toMatchObject({
      auctionId: AUCTION,
      startingPrice: '100.00',
      closesAt: T,
    });
    expect(toLotNotification(events.BidPlaced)).toMatchObject({
      amount: '105.50',
      placedAt: '2026-11-13T19:00:00.000Z',
    });
    expect(toLotNotification(events.LotExtended)).toMatchObject({
      newClosesAt: '2026-11-13T20:05:00.000Z',
    });
    expect(toLotNotification(events.LotClosed)).toMatchObject({
      finalAmount: '105.50',
      hasWinner: true,
    });
  });

  it('un lote desierto se notifica sin importe y sin ganador', () => {
    const desierto = buildEvent('LotClosed', TENANT, {
      lotId: LOT,
      winnerId: null,
      finalAmount: null,
    });
    expect(toLotNotification(desierto)).toMatchObject({ finalAmount: null, hasWinner: false });
  });

  it('nunca revela la identidad del postor ni del ganador', () => {
    for (const type of ['BidPlaced', 'LotClosed'] as const) {
      const text = JSON.stringify(toLotNotification(events[type]));
      expect(text).not.toContain(ANA);
      expect(text).not.toMatch(/bidderId|winnerId/);
    }
  });
});

describe('lotNotificationSchema', () => {
  const sample = toLotNotification(events.BidPlaced);

  it('rechaza campos desconocidos (contrato cerrado)', () => {
    expect(lotNotificationSchema.safeParse({ ...sample, bidderId: ANA }).success).toBe(false);
  });
  it('rechaza un tipo desconocido y un importe con formato inválido', () => {
    expect(lotNotificationSchema.safeParse({ ...sample, type: 'Otra' }).success).toBe(false);
    expect(lotNotificationSchema.safeParse({ ...sample, amount: 10.5 }).success).toBe(false);
  });
  it('cada notificación cabe con holgura en el límite de NOTIFY (8 000 bytes)', () => {
    for (const type of ['LotPublished', 'BidPlaced', 'LotExtended', 'LotClosed'] as const) {
      expect(Buffer.byteLength(JSON.stringify(toLotNotification(events[type])))).toBeLessThan(
        1_000,
      );
    }
  });
});
