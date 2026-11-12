import { describe, expect, it } from 'vitest';
import { buildEvent, parseEvent, partitionKey, type EventType } from './index.js';

const V7 = '0190a5c0-0000-7000-8000-000000000001';
const V4 = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const TENANT = '11111111-1111-4111-8111-111111111111';
const AUCTION = '22222222-2222-4222-8222-222222222222';
const LOT = '33333333-3333-4333-8333-333333333333';
const BIDDER = '44444444-4444-4444-8444-444444444444';
const AT = '2026-11-12T19:00:00.000Z';
const LATER = '2026-11-13T19:00:00.000Z';

const payloads: Record<EventType, Record<string, unknown>> = {
  AuctionOpened: { auctionId: AUCTION, title: 'Arte', opensAt: AT, closesAt: LATER },
  LotPublished: {
    lotId: LOT,
    auctionId: AUCTION,
    title: 'Óleo',
    startingPrice: '100.00',
    minIncrement: '5',
    currency: 'USD',
    closesAt: LATER,
  },
  BidPlaced: { lotId: LOT, bidderId: BIDDER, amount: '105.50', placedAt: AT },
  BidRejected: { lotId: LOT, bidderId: BIDDER, amount: '1.00', reason: 'BID_TOO_LOW' },
  LotExtended: { lotId: LOT, newClosesAt: LATER, reason: 'anti-sniping' },
  LotClosed: { lotId: LOT, winnerId: BIDDER, finalAmount: '105.50' },
  AuctionClosed: { auctionId: AUCTION },
};
const types = Object.keys(payloads) as EventType[];

function raw(type: EventType, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: V7,
    type,
    occurredAt: AT,
    tenantId: TENANT,
    version: 1,
    payload: payloads[type],
    ...over,
  };
}

function payloadOf(type: EventType, over: Record<string, unknown>): Record<string, unknown> {
  return raw(type, { payload: { ...payloads[type], ...over } });
}

describe('contrato de eventos', () => {
  it.each(types)('acepta un %s válido', (type) => {
    const result = parseEvent(raw(type));
    expect(result.success).toBe(true);
    if (result.success) expect(result.event.type).toBe(type);
  });

  it.each(['eventId', 'type', 'occurredAt', 'tenantId', 'version', 'payload'])(
    'rechaza un evento sin %s',
    (field) => {
      const e = Object.fromEntries(
        Object.entries(raw('AuctionClosed')).filter(([k]) => k !== field),
      );
      expect(parseEvent(e).success).toBe(false);
    },
  );

  it('exige eventId UUID v7 y rechaza v4', () => {
    expect(parseEvent(raw('AuctionClosed', { eventId: V4 })).success).toBe(false);
    expect(parseEvent(raw('AuctionClosed', { eventId: V7 })).success).toBe(true);
  });

  it('rechaza type desconocido', () => {
    expect(parseEvent(raw('AuctionClosed', { type: 'LotExploded' })).success).toBe(false);
  });

  it('rechaza campos desconocidos en el sobre y en el payload', () => {
    expect(parseEvent(raw('AuctionClosed', { extra: 1 })).success).toBe(false);
    expect(parseEvent(payloadOf('AuctionClosed', { extra: 1 })).success).toBe(false);
  });

  it('rechaza una version distinta de 1', () => {
    expect(parseEvent(raw('AuctionClosed', { version: 2 })).success).toBe(false);
  });

  describe('dinero', () => {
    it.each(['10.50', '10', '0.5', '9999999999.99'])('acepta %s', (amount) => {
      expect(parseEvent(payloadOf('BidPlaced', { amount })).success).toBe(true);
    });
    it.each([10.5, '10.505', '-1', '1e3', '', '12345678901', '1.', '.5', '1,5'])(
      'rechaza %s',
      (amount) => {
        expect(parseEvent(payloadOf('BidPlaced', { amount })).success).toBe(false);
      },
    );
  });

  describe('fechas', () => {
    it.each(['2026-11-12T19:00:00', '2026-11-12T19:00:00+02:00', '2026-11-12', 'ayer'])(
      'rechaza occurredAt %s',
      (occurredAt) => {
        expect(parseEvent(raw('AuctionClosed', { occurredAt })).success).toBe(false);
      },
    );
    it('rechaza una subasta que cierra antes de abrir', () => {
      expect(parseEvent(payloadOf('AuctionOpened', { opensAt: LATER, closesAt: AT })).success).toBe(
        false,
      );
    });
  });

  it('rechaza LotExtended con un motivo distinto de anti-sniping', () => {
    expect(parseEvent(payloadOf('LotExtended', { reason: 'manual' })).success).toBe(false);
  });

  it('rechaza una moneda que no son 3 mayúsculas', () => {
    expect(parseEvent(payloadOf('LotPublished', { currency: 'usd' })).success).toBe(false);
    expect(parseEvent(payloadOf('LotPublished', { currency: 'USDX' })).success).toBe(false);
  });

  it('rechaza un motivo de rechazo desconocido', () => {
    expect(parseEvent(payloadOf('BidRejected', { reason: 'PORQUE_SI' })).success).toBe(false);
  });

  describe('LotClosed sin pujas', () => {
    it('acepta winnerId y finalAmount ambos null', () => {
      expect(
        parseEvent(payloadOf('LotClosed', { winnerId: null, finalAmount: null })).success,
      ).toBe(true);
    });
    it('rechaza uno solo en null', () => {
      expect(parseEvent(payloadOf('LotClosed', { winnerId: null })).success).toBe(false);
      expect(parseEvent(payloadOf('LotClosed', { finalAmount: null })).success).toBe(false);
    });
  });

  describe('meta reservado', () => {
    it('es opcional y acepta correlationId y signature', () => {
      expect(parseEvent(raw('AuctionClosed')).success).toBe(true);
      expect(
        parseEvent(raw('AuctionClosed', { meta: { correlationId: 'req-1', signature: 'abc' } }))
          .success,
      ).toBe(true);
    });
    it('rechaza claves desconocidas', () => {
      expect(parseEvent(raw('AuctionClosed', { meta: { otra: 1 } })).success).toBe(false);
    });
  });

  describe('buildEvent', () => {
    const deps = { newId: () => V7, now: () => new Date(AT) };

    it('es reproducible con id y reloj inyectados', () => {
      const e = buildEvent('AuctionClosed', TENANT, { auctionId: AUCTION }, { deps });
      expect(e).toEqual({
        eventId: V7,
        type: 'AuctionClosed',
        occurredAt: AT,
        tenantId: TENANT,
        version: 1,
        payload: { auctionId: AUCTION },
      });
    });

    it('genera un UUID v7 y la hora actual si no se inyecta nada', () => {
      const before = Date.now();
      const e = buildEvent('AuctionClosed', TENANT, { auctionId: AUCTION });
      expect(parseEvent(e).success).toBe(true);
      expect(Date.parse(e.occurredAt)).toBeGreaterThanOrEqual(before);
    });

    it('lanza si el payload no cumple el contrato', () => {
      expect(() =>
        buildEvent('BidPlaced', TENANT, {
          lotId: LOT,
          bidderId: BIDDER,
          amount: '1.999',
          placedAt: AT,
        }),
      ).toThrow();
    });

    it('incluye meta cuando se pasa', () => {
      const e = buildEvent(
        'AuctionClosed',
        TENANT,
        { auctionId: AUCTION },
        { deps, meta: { correlationId: 'req-1' } },
      );
      expect(e.meta).toEqual({ correlationId: 'req-1' });
    });
  });

  it('hace round-trip por JSON sin perder nada', () => {
    for (const type of types) {
      const parsed = parseEvent(raw(type));
      if (!parsed.success) throw new Error(`${type} debería ser válido`);
      const again = parseEvent(JSON.parse(JSON.stringify(parsed.event)));
      expect(again).toEqual(parsed);
    }
  });

  describe('partitionKey (ADR-0001)', () => {
    const key = (type: EventType): string => {
      const r = parseEvent(raw(type));
      if (!r.success) throw new Error(`${type} debería ser válido`);
      return partitionKey(r.event);
    };
    it.each(['LotPublished', 'BidPlaced', 'BidRejected', 'LotExtended', 'LotClosed'] as const)(
      '%s usa lotId',
      (type) => {
        expect(key(type)).toBe(LOT);
      },
    );
    it.each(['AuctionOpened', 'AuctionClosed'] as const)('%s usa auctionId', (type) => {
      expect(key(type)).toBe(AUCTION);
    });
  });
});
