import { foldLot, parseEvent, type DomainEvent } from '@bidstream/domain';
import { describe, expect, it } from 'vitest';
import { generateHistory } from './history.js';

const options = { seed: 42, auctions: 4, lotsPerAuction: 3, bidsPerLot: 10 };

describe('generateHistory', () => {
  const history = generateHistory(options);

  it('es determinista: la misma semilla produce exactamente el mismo historial', () => {
    expect(generateHistory(options)).toEqual(history);
  });

  it('una semilla distinta produce un historial distinto', () => {
    expect(generateHistory({ ...options, seed: 43 })).not.toEqual(history);
  });

  it('todos los eventos cumplen el contrato (parseEvent)', () => {
    for (const e of history) expect(parseEvent(e).success).toBe(true);
  });

  it('los eventId son únicos y el tiempo no retrocede', () => {
    expect(new Set(history.map((e) => e.eventId)).size).toBe(history.length);
    const times = history.map((e) => Date.parse(e.occurredAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('cubre los siete tipos de evento, con ganadores y lotes desiertos', () => {
    const types = new Set(history.map((e) => e.type));
    expect([...types].sort()).toEqual(
      [
        'AuctionClosed',
        'AuctionOpened',
        'BidPlaced',
        'BidRejected',
        'LotClosed',
        'LotExtended',
        'LotPublished',
      ].sort(),
    );
    const closes = history.filter((e) => e.type === 'LotClosed');
    expect(closes.some((e) => e.payload.winnerId !== null)).toBe(true);
    expect(closes.some((e) => e.payload.winnerId === null)).toBe(true);
  });

  it('tiene el tamaño esperado: 4 subastas × 3 lotes y unos cientos de eventos', () => {
    expect(history.filter((e) => e.type === 'AuctionOpened')).toHaveLength(4);
    expect(history.filter((e) => e.type === 'LotPublished')).toHaveLength(12);
    expect(history.filter((e) => e.type === 'AuctionClosed')).toHaveLength(4);
    expect(history.length).toBeGreaterThan(100);
  });

  it('el historial de cada lote respeta las reglas: sin doble adjudicación y el precio solo crece', () => {
    const lotIds = history.filter((e) => e.type === 'LotPublished').map((e) => e.payload.lotId);
    for (const lotId of lotIds) {
      const own: DomainEvent[] = history.filter(
        (e) => 'lotId' in e.payload && e.payload.lotId === lotId,
      );
      expect(own.filter((e) => e.type === 'LotClosed')).toHaveLength(1);
      const prices = own.filter((e) => e.type === 'BidPlaced').map((e) => Number(e.payload.amount));
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
      expect(foldLot(own)?.status).toBe('closed');
    }
  });

  it('los eventos de cada lote van detrás de la apertura de su subasta', () => {
    const opened = new Set<string>();
    for (const e of history) {
      if (e.type === 'AuctionOpened') opened.add(e.payload.auctionId);
      if (e.type === 'LotPublished') expect(opened.has(e.payload.auctionId)).toBe(true);
    }
  });
});
