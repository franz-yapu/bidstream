import { describe, expect, it } from 'vitest';
import { buildEvent, parseEvent } from '../events/index.js';
import type { AuctionState } from '../auction/state.js';
import { foldLot } from '../lot/state.js';
import {
  buildDepsFrom,
  FixedClock,
  InMemoryAuctionRepository,
  InMemoryLotRepository,
  RecordingEventPublisher,
  SequentialIdGenerator,
} from './index.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '12121212-1212-4212-8212-121212121212';
const AUCTION = '22222222-2222-4222-8222-222222222222';
const LOT = '33333333-3333-4333-8333-333333333333';
const START = new Date('2026-11-12T19:00:00.000Z');

describe('FixedClock', () => {
  it('devuelve siempre la misma hora hasta que se avanza', () => {
    const clock = new FixedClock(START);
    expect(clock.now()).toEqual(START);
    expect(clock.now()).toEqual(START);
    clock.advance(60_000);
    expect(clock.now()).toEqual(new Date('2026-11-12T19:01:00.000Z'));
  });
  it('no se altera si se muta la fecha devuelta', () => {
    const clock = new FixedClock(START);
    clock.now().setFullYear(2000);
    expect(clock.now()).toEqual(START);
  });
});

describe('SequentialIdGenerator', () => {
  it('produce UUID v7 válidos, distintos y reproducibles', () => {
    const a = new SequentialIdGenerator();
    const b = new SequentialIdGenerator();
    const first = [a.newId(), a.newId(), a.newId()];
    expect(new Set(first).size).toBe(3);
    expect([b.newId(), b.newId(), b.newId()]).toEqual(first);
    for (const id of first) {
      const event = buildEvent(
        'AuctionClosed',
        T1,
        { auctionId: AUCTION },
        {
          deps: { newId: () => id, now: () => START },
        },
      );
      expect(parseEvent(event).success).toBe(true);
    }
  });
});

describe('buildDepsFrom', () => {
  it('alimenta buildEvent con el reloj y el generador inyectados', () => {
    const deps = buildDepsFrom(new FixedClock(START), new SequentialIdGenerator());
    const event = buildEvent('AuctionClosed', T1, { auctionId: AUCTION }, { deps });
    expect(event.eventId).toBe('0190a5c0-0000-7000-8000-000000000001');
    expect(event.occurredAt).toBe(START.toISOString());
  });
});

describe('repositorios en memoria', () => {
  const lot = foldLot([
    {
      type: 'LotPublished',
      payload: {
        lotId: LOT,
        auctionId: AUCTION,
        title: 'x',
        startingPrice: '1.00',
        minIncrement: '1.00',
        currency: 'USD',
        closesAt: '2026-11-13T19:00:00.000Z',
      },
    },
  ]);
  if (lot === undefined) throw new Error('lote esperado');
  const auction: AuctionState = { auctionId: AUCTION, status: 'open', openLotIds: new Set() };

  it('devuelve null si el lote no existe', async () => {
    expect(await new InMemoryLotRepository().findById(T1, LOT)).toBeNull();
  });
  it('aísla los lotes por tenant', async () => {
    const repo = new InMemoryLotRepository();
    repo.set(T1, lot);
    expect(await repo.findById(T1, LOT)).toBe(lot);
    expect(await repo.findById(T2, LOT)).toBeNull();
  });
  it('aísla las subastas por tenant', async () => {
    const repo = new InMemoryAuctionRepository();
    repo.set(T1, auction);
    expect(await repo.findById(T1, AUCTION)).toBe(auction);
    expect(await repo.findById(T2, AUCTION)).toBeNull();
    expect(await new InMemoryAuctionRepository().findById(T1, AUCTION)).toBeNull();
  });
});

describe('RecordingEventPublisher', () => {
  it('conserva los eventos en el orden publicado', async () => {
    const deps = buildDepsFrom(new FixedClock(START), new SequentialIdGenerator());
    const e1 = buildEvent('AuctionClosed', T1, { auctionId: AUCTION }, { deps });
    const e2 = buildEvent('AuctionClosed', T1, { auctionId: LOT }, { deps });
    const publisher = new RecordingEventPublisher();
    await publisher.publish([e1]);
    await publisher.publish([e2]);
    expect(publisher.published).toEqual([e1, e2]);
  });
});
