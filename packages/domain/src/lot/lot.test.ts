import { describe, expect, it } from 'vitest';
import type { EventDraft } from '../draft.js';
import { formatMoney, parseMoney } from '../money.js';
import { compareBids, decideBid, minimumBid, type AntiSnipingConfig } from './decide-bid.js';
import { decideCloseLot } from './decide-close.js';
import { evolveLot, foldLot, type LotState } from './state.js';

const LOT = '33333333-3333-4333-8333-333333333333';
const AUCTION = '22222222-2222-4222-8222-222222222222';
const ANA = '44444444-4444-4444-8444-444444444444';
const BEN = '55555555-5555-4555-8555-555555555555';
const CLOSES = new Date('2026-11-12T20:00:00.000Z');
const MIN = 60_000;
const CONFIG: AntiSnipingConfig = { windowMs: 5 * MIN, extensionMs: 5 * MIN };
const at = (offsetMs: number): Date => new Date(CLOSES.getTime() + offsetMs);

const published: EventDraft = {
  type: 'LotPublished',
  payload: {
    lotId: LOT,
    auctionId: AUCTION,
    title: 'Óleo',
    startingPrice: '100.00',
    minIncrement: '5.00',
    currency: 'USD',
    closesAt: CLOSES.toISOString(),
  },
};

function lot(...events: EventDraft[]): LotState {
  const state = foldLot([published, ...events]);
  if (state === undefined) throw new Error('el lote debería existir');
  return state;
}

function bid(state: LotState, bidderId: string, amount: string, placedAt: Date): EventDraft[] {
  return decideBid(state, { bidderId, amount: parseMoney(amount), placedAt }, CONFIG);
}

const types = (events: EventDraft[]): string[] => events.map((e) => e.type);

describe('regla 1: puja válida', () => {
  it('la primera puja puede igualar el precio de salida', () => {
    expect(types(bid(lot(), ANA, '100.00', at(-3_600_000)))).toEqual(['BidPlaced']);
  });
  it('la primera puja por debajo del precio de salida se rechaza', () => {
    const [e] = bid(lot(), ANA, '99.99', at(-3_600_000));
    expect(e).toMatchObject({ type: 'BidRejected', payload: { reason: 'BID_TOO_LOW' } });
  });
  it('con pujas, exige precio actual + incremento mínimo (frontera)', () => {
    const state = lot({
      type: 'BidPlaced',
      payload: {
        lotId: LOT,
        bidderId: ANA,
        amount: '100.00',
        placedAt: at(-7_200_000).toISOString(),
      },
    });
    expect(formatMoney(minimumBid(state))).toBe('105.00');
    expect(types(bid(state, BEN, '105.00', at(-3_600_000)))).toEqual(['BidPlaced']);
    expect(types(bid(state, BEN, '104.99', at(-3_600_000)))).toEqual(['BidRejected']);
  });
  it('una puja igual al precio vigente se rechaza (a igual monto gana la primera)', () => {
    const state = lot({
      type: 'BidPlaced',
      payload: {
        lotId: LOT,
        bidderId: ANA,
        amount: '120.00',
        placedAt: at(-7_200_000).toISOString(),
      },
    });
    expect(types(bid(state, BEN, '120.00', at(-3_600_000)))).toEqual(['BidRejected']);
  });
  it('un postor puede subir su propia puja', () => {
    const state = lot({
      type: 'BidPlaced',
      payload: {
        lotId: LOT,
        bidderId: ANA,
        amount: '100.00',
        placedAt: at(-7_200_000).toISOString(),
      },
    });
    expect(types(bid(state, ANA, '110.00', at(-3_600_000)))).toEqual(['BidPlaced']);
  });
});

describe('regla 2: desempate determinista', () => {
  const a = { id: 'a', amount: 1000n, placedAt: new Date(1000) };
  it('mayor monto primero', () => {
    expect(compareBids({ ...a, amount: 2000n }, a)).toBeLessThan(0);
  });
  it('mismo monto: la más antigua primero', () => {
    expect(compareBids(a, { ...a, placedAt: new Date(2000) })).toBeLessThan(0);
  });
  it('mismo monto e instante: menor id primero', () => {
    expect(compareBids(a, { ...a, id: 'b' })).toBeLessThan(0);
    expect(compareBids({ ...a, id: 'b' }, a)).toBeGreaterThan(0);
    expect(compareBids(a, a)).toBe(0);
  });
  it('ordena de forma estable e independiente del orden de entrada', () => {
    const bids = [
      { id: 'c', amount: 500n, placedAt: new Date(1) },
      { id: 'a', amount: 900n, placedAt: new Date(5) },
      { id: 'b', amount: 900n, placedAt: new Date(2) },
    ];
    const expected = ['b', 'a', 'c'];
    expect([...bids].sort(compareBids).map((x) => x.id)).toEqual(expected);
    expect(
      [...bids]
        .reverse()
        .sort(compareBids)
        .map((x) => x.id),
    ).toEqual(expected);
  });
});

describe('regla 3: anti-sniping', () => {
  it('fuera de la ventana no extiende', () => {
    expect(types(bid(lot(), ANA, '100.00', at(-5 * MIN - 1)))).toEqual(['BidPlaced']);
  });
  it('en el borde de la ventana extiende (inclusivo)', () => {
    expect(types(bid(lot(), ANA, '100.00', at(-5 * MIN)))).toEqual(['BidPlaced', 'LotExtended']);
  });
  it('dentro de la ventana extiende desde closesAt', () => {
    const events = bid(lot(), ANA, '100.00', at(-MIN));
    expect(events[1]).toEqual({
      type: 'LotExtended',
      payload: { lotId: LOT, newClosesAt: at(5 * MIN).toISOString(), reason: 'anti-sniping' },
    });
  });
  it('una puja rechazada no extiende el cierre', () => {
    expect(types(bid(lot(), ANA, '50.00', at(-MIN)))).toEqual(['BidRejected']);
  });
  it('sin extensión configurada no emite LotExtended', () => {
    const events = decideBid(
      lot(),
      { bidderId: ANA, amount: parseMoney('100'), placedAt: at(-MIN) },
      { windowMs: 5 * MIN, extensionMs: 0 },
    );
    expect(types(events)).toEqual(['BidPlaced']);
  });
});

describe('cierre y regla 5: adjudicación única', () => {
  it('una puja en closesAt o después se rechaza con LOT_CLOSED', () => {
    for (const offset of [0, 1, MIN]) {
      const [e] = bid(lot(), ANA, '500.00', at(offset));
      expect(e).toMatchObject({ type: 'BidRejected', payload: { reason: 'LOT_CLOSED' } });
    }
  });
  it('adjudica al mejor postor con su monto', () => {
    const state = lot(
      {
        type: 'BidPlaced',
        payload: {
          lotId: LOT,
          bidderId: ANA,
          amount: '100.00',
          placedAt: at(-9 * MIN).toISOString(),
        },
      },
      {
        type: 'BidPlaced',
        payload: {
          lotId: LOT,
          bidderId: BEN,
          amount: '150.00',
          placedAt: at(-8 * MIN).toISOString(),
        },
      },
    );
    expect(decideCloseLot(state, CLOSES)).toEqual([
      { type: 'LotClosed', payload: { lotId: LOT, winnerId: BEN, finalAmount: '150.00' } },
    ]);
  });
  it('un lote sin pujas se cierra desierto', () => {
    expect(decideCloseLot(lot(), at(MIN))).toEqual([
      { type: 'LotClosed', payload: { lotId: LOT, winnerId: null, finalAmount: null } },
    ]);
  });
  it('no cierra antes de closesAt', () => {
    expect(decideCloseLot(lot(), at(-1))).toEqual([]);
  });
  it('tras cerrar: no se vuelve a adjudicar y las pujas se rechazan', () => {
    const closed = evolveLot(lot(), decideCloseLot(lot(), CLOSES)[0] as EventDraft);
    expect(closed?.status).toBe('closed');
    if (closed === undefined) throw new Error('estado esperado');
    expect(decideCloseLot(closed, at(MIN))).toEqual([]);
    expect(types(bid(closed, ANA, '999.00', at(-MIN)))).toEqual(['BidRejected']);
  });
});

describe('evolveLot y reproducibilidad', () => {
  const log: EventDraft[] = [
    published,
    {
      type: 'BidPlaced',
      payload: {
        lotId: LOT,
        bidderId: ANA,
        amount: '100.00',
        placedAt: at(-2 * MIN).toISOString(),
      },
    },
    {
      type: 'LotExtended',
      payload: { lotId: LOT, newClosesAt: at(5 * MIN).toISOString(), reason: 'anti-sniping' },
    },
    {
      type: 'BidRejected',
      payload: { lotId: LOT, bidderId: BEN, amount: '1.00', reason: 'BID_TOO_LOW' },
    },
    { type: 'LotClosed', payload: { lotId: LOT, winnerId: ANA, finalAmount: '100.00' } },
  ];
  it('deja el estado esperado tras la secuencia completa', () => {
    expect(foldLot(log)).toMatchObject({
      status: 'closed',
      currentPrice: 10000n,
      winnerId: ANA,
      finalAmount: 10000n,
      closesAt: at(5 * MIN),
    });
  });
  it('plegar el mismo log dos veces da el mismo estado', () => {
    expect(foldLot(log)).toEqual(foldLot(log));
  });
  it('ignora eventos de un lote que aún no existe y un LotPublished repetido', () => {
    expect(evolveLot(undefined, log[1] as EventDraft)).toBeUndefined();
    const state = lot();
    expect(evolveLot(state, published)).toBe(state);
  });
});

describe('invariante: el precio vigente solo crece', () => {
  it('con pujas aleatorias el precio nunca baja y cada aceptada cumple el mínimo', () => {
    let seed = 42;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    let state = lot();
    let previous = 0n;
    for (let i = 0; i < 300; i++) {
      const amount = BigInt(Math.floor(rnd() * 50_000));
      const required = minimumBid(state);
      const events = bid(state, i % 2 === 0 ? ANA : BEN, formatMoney(amount), at(-3_600_000 + i));
      const accepted = events[0]?.type === 'BidPlaced';
      expect(accepted).toBe(amount >= required);
      for (const e of events) state = evolveLot(state, e) ?? state;
      expect((state.currentPrice ?? 0n) >= previous).toBe(true);
      previous = state.currentPrice ?? 0n;
    }
  });
});
