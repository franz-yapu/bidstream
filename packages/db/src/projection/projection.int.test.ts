import { randomUUID } from 'node:crypto';
import {
  buildEvent,
  evolveAuction,
  foldLot,
  type AuctionState,
  type DomainEvent,
} from '@bidstream/domain';
import { createTestDatabase, type TestDatabase } from '@bidstream/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyEventToProjection,
  createPrismaClient,
  PrismaAuctionRepository,
  PrismaLotRepository,
  ProjectionError,
  resetProjection,
} from '../index.js';

// La proyección contra PostgreSQL real (base desechable). El estado resultante se compara con el
// que reconstruye el dominio (`foldLot`, `evolveAuction`) del mismo historial.
const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '99999999-9999-4999-8999-999999999999';
const ANA = '44444444-4444-4444-8444-444444444444';
const BEN = '55555555-5555-4555-8555-555555555555';
const OPENS = '2026-11-12T10:00:00.000Z';
const CLOSES = '2026-11-12T20:00:00.000Z';
const EXTENDED = '2026-11-12T20:05:00.000Z';

let db: TestDatabase;
let prisma: ReturnType<typeof createPrismaClient>;
let lots: PrismaLotRepository;
let auctions: PrismaAuctionRepository;

beforeAll(async () => {
  db = await createTestDatabase();
  // Cliente del propio paquete (src): el de @bidstream/testing viene de dist y TypeScript los
  // trata como clases distintas.
  prisma = createPrismaClient(db.url);
  lots = new PrismaLotRepository(prisma);
  auctions = new PrismaAuctionRepository(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
  await db.drop();
});

const apply = (event: DomainEvent): Promise<void> =>
  prisma.$transaction((tx) => applyEventToProjection(tx, event));

const id = (): string => randomUUID();

interface Scenario {
  readonly auctionId: string;
  readonly lotId: string;
  readonly opened: DomainEvent;
  readonly published: DomainEvent;
}

function scenario(tenant = TENANT): Scenario {
  const auctionId = id();
  const lotId = id();
  return {
    auctionId,
    lotId,
    opened: buildEvent('AuctionOpened', tenant, {
      auctionId,
      title: 'Arte',
      opensAt: OPENS,
      closesAt: CLOSES,
    }),
    published: buildEvent('LotPublished', tenant, {
      lotId,
      auctionId,
      title: 'Óleo',
      startingPrice: '100.00',
      minIncrement: '5.00',
      currency: 'USD',
      closesAt: CLOSES,
    }),
  };
}

const bid = (lotId: string, bidderId: string, amount: string, tenant = TENANT): DomainEvent =>
  buildEvent('BidPlaced', tenant, {
    lotId,
    bidderId,
    amount,
    placedAt: '2026-11-12T19:00:00.000Z',
  });

const closed = (
  lotId: string,
  winnerId: string | null,
  finalAmount: string | null,
  tenant = TENANT,
): DomainEvent => buildEvent('LotClosed', tenant, { lotId, winnerId, finalAmount });

async function snapshot(): Promise<unknown> {
  const [auction, lot, bids] = await Promise.all([
    prisma.auction.findMany({ orderBy: { id: 'asc' } }),
    prisma.lot.findMany({ orderBy: { id: 'asc' } }),
    prisma.bid.findMany({ orderBy: { id: 'asc' } }),
  ]);
  return JSON.parse(JSON.stringify({ auction, lot, bids })) as unknown;
}

describe('efecto de cada evento', () => {
  it('AuctionOpened inserta la subasta abierta con el tenant del evento', async () => {
    const s = scenario();
    await apply(s.opened);
    const row = await prisma.auction.findUniqueOrThrow({ where: { id: s.auctionId } });
    expect(row).toMatchObject({ tenantId: TENANT, title: 'Arte', status: 'OPEN' });
    expect(row.opensAt).toEqual(new Date(OPENS));
  });

  it('LotPublished inserta el lote abierto sin precio vigente', async () => {
    const s = scenario();
    await apply(s.opened);
    await apply(s.published);
    const lot = await lots.findById(TENANT, s.lotId);
    expect(lot).toMatchObject({ status: 'open', currentPrice: null, startingPrice: 10000n });
  });

  it('BidPlaced inserta la puja con id = eventId y actualiza el precio vigente', async () => {
    const s = scenario();
    await apply(s.opened);
    await apply(s.published);
    const placed = bid(s.lotId, ANA, '105.50');
    await apply(placed);
    const row = await prisma.bid.findUniqueOrThrow({ where: { id: placed.eventId } });
    expect(row).toMatchObject({ lotId: s.lotId, bidderId: ANA, awarded: false });
    expect(await lots.findById(TENANT, s.lotId)).toMatchObject({
      currentPrice: 10550n,
      currentBidderId: ANA,
    });
  });

  it('BidRejected no cambia nada', async () => {
    const s = scenario();
    await apply(s.opened);
    await apply(s.published);
    const before = await snapshot();
    await apply(
      buildEvent('BidRejected', TENANT, {
        lotId: s.lotId,
        bidderId: BEN,
        amount: '1.00',
        reason: 'BID_TOO_LOW',
      }),
    );
    expect(await snapshot()).toEqual(before);
  });

  it('LotExtended actualiza el cierre y AuctionClosed cierra la subasta', async () => {
    const s = scenario();
    await apply(s.opened);
    await apply(s.published);
    await apply(
      buildEvent('LotExtended', TENANT, {
        lotId: s.lotId,
        newClosesAt: EXTENDED,
        reason: 'anti-sniping',
      }),
    );
    expect((await lots.findById(TENANT, s.lotId))?.closesAt).toEqual(new Date(EXTENDED));
    await apply(buildEvent('AuctionClosed', TENANT, { auctionId: s.auctionId }));
    expect((await auctions.findById(TENANT, s.auctionId))?.status).toBe('closed');
  });
});

describe('coherencia con el dominio', () => {
  it('un historial completo deja el mismo estado que foldLot y evolveAuction', async () => {
    const s = scenario();
    const history: DomainEvent[] = [
      s.opened,
      s.published,
      bid(s.lotId, ANA, '100.00'),
      bid(s.lotId, BEN, '105.50'),
      buildEvent('LotExtended', TENANT, {
        lotId: s.lotId,
        newClosesAt: EXTENDED,
        reason: 'anti-sniping',
      }),
      bid(s.lotId, ANA, '110.00'),
      buildEvent('BidRejected', TENANT, {
        lotId: s.lotId,
        bidderId: BEN,
        amount: '108.00',
        reason: 'BID_TOO_LOW',
      }),
      closed(s.lotId, ANA, '110.00'),
    ];
    for (const e of history) await apply(e);

    const expectedLot = foldLot(history);
    expect(await lots.findById(TENANT, s.lotId)).toEqual(expectedLot);
    expect(expectedLot).toMatchObject({ status: 'closed', winnerId: ANA, finalAmount: 11000n });

    const expectedAuction = history.reduce<AuctionState | undefined>(evolveAuction, undefined);
    // El lote ya cerró: la subasta no tiene lotes abiertos.
    expect(await auctions.findById(TENANT, s.auctionId)).toEqual(expectedAuction);
  });

  it('adjudica solo la puja de mayor ranking', async () => {
    const s = scenario();
    for (const e of [
      s.opened,
      s.published,
      bid(s.lotId, ANA, '100.00'),
      bid(s.lotId, BEN, '150.00'),
    ])
      await apply(e);
    await apply(closed(s.lotId, BEN, '150.00'));
    const bids = await prisma.bid.findMany({ where: { lotId: s.lotId } });
    expect(bids.filter((b) => b.awarded).map((b) => b.bidderId)).toEqual([BEN]);
  });

  it('un lote desierto se cierra sin ganador ni pujas adjudicadas', async () => {
    const s = scenario();
    await apply(s.opened);
    await apply(s.published);
    await apply(closed(s.lotId, null, null));
    expect(await lots.findById(TENANT, s.lotId)).toMatchObject({
      status: 'closed',
      winnerId: null,
      finalAmount: null,
    });
  });

  it('LotPublished antes que AuctionOpened se aplica bien (sin clave foránea) y luego queda coherente', async () => {
    const s = scenario();
    await apply(s.published); // el lote llega antes que su subasta (particiones distintas)
    await apply(s.opened);
    const state = await auctions.findById(TENANT, s.auctionId);
    expect(state?.openLotIds).toEqual(new Set([s.lotId]));
  });
});

describe('estado incoherente o faltante: lanza, no ignora', () => {
  it('LotClosed con un ganador que no es la puja de mayor ranking lanza y no modifica nada', async () => {
    const s = scenario();
    for (const e of [
      s.opened,
      s.published,
      bid(s.lotId, ANA, '100.00'),
      bid(s.lotId, BEN, '150.00'),
    ])
      await apply(e);
    const before = await snapshot();
    await expect(apply(closed(s.lotId, ANA, '100.00'))).rejects.toThrow(ProjectionError);
    await expect(apply(closed(s.lotId, BEN, '149.00'))).rejects.toThrow(ProjectionError);
    expect(await snapshot()).toEqual(before);
    expect((await lots.findById(TENANT, s.lotId))?.status).toBe('open');
  });

  it('LotClosed sin ganador sobre un lote con pujas lanza', async () => {
    const s = scenario();
    for (const e of [s.opened, s.published, bid(s.lotId, ANA, '100.00')]) await apply(e);
    await expect(apply(closed(s.lotId, null, null))).rejects.toThrow(ProjectionError);
  });

  it.each([
    ['BidPlaced', (lotId: string) => bid(lotId, ANA, '100.00')],
    [
      'LotExtended',
      (lotId: string) =>
        buildEvent('LotExtended', TENANT, { lotId, newClosesAt: EXTENDED, reason: 'anti-sniping' }),
    ],
    ['LotClosed', (lotId: string) => closed(lotId, null, null)],
  ])('%s sobre un lote inexistente lanza ProjectionError', async (_type, make) => {
    await expect(apply(make(id()))).rejects.toThrow(ProjectionError);
  });

  it('AuctionClosed sobre una subasta inexistente lanza', async () => {
    await expect(apply(buildEvent('AuctionClosed', TENANT, { auctionId: id() }))).rejects.toThrow(
      ProjectionError,
    );
  });

  it('un evento de otro tenant no puede tocar el lote de este', async () => {
    const s = scenario();
    await apply(s.opened);
    await apply(s.published);
    await expect(apply(bid(s.lotId, ANA, '100.00', OTHER_TENANT))).rejects.toThrow(ProjectionError);
    expect((await lots.findById(TENANT, s.lotId))?.currentPrice).toBeNull();
  });
});

describe('migración 0002', () => {
  it('quita la clave foránea lote → subasta y conserva la de puja → lote', async () => {
    const { rows } = await db.pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE contype = 'f' ORDER BY conname`,
    );
    const names = rows.map((r) => r.conname);
    expect(names).not.toContain('lot_auction_id_fkey');
    expect(names).toContain('bid_lot_id_fkey');
  });
});

describe('reproceso', () => {
  it('resetProjection vacía la proyección y solo los registros del projector', async () => {
    const s = scenario();
    await apply(s.opened);
    await apply(s.published);
    await apply(bid(s.lotId, ANA, '100.00'));
    const eventId = id();
    await prisma.processedEvent.createMany({
      data: [
        { eventId, consumer: 'projector' },
        { eventId, consumer: 'notifier' },
      ],
    });

    await resetProjection(prisma);

    expect(await prisma.auction.count()).toBe(0);
    expect(await prisma.lot.count()).toBe(0);
    expect(await prisma.bid.count()).toBe(0);
    const remaining = await prisma.processedEvent.findMany({ where: { eventId } });
    expect(remaining.map((r) => r.consumer)).toEqual(['notifier']);
  });

  it('tras resetProjection, volver a aplicar el mismo log da exactamente el mismo estado', async () => {
    const a = scenario();
    const b = scenario();
    const log: DomainEvent[] = [
      a.opened,
      a.published,
      b.published, // el lote de la segunda subasta llega antes que su subasta
      bid(a.lotId, ANA, '100.00'),
      b.opened,
      bid(a.lotId, BEN, '120.00'),
      bid(b.lotId, ANA, '101.00'),
      buildEvent('LotExtended', TENANT, {
        lotId: a.lotId,
        newClosesAt: EXTENDED,
        reason: 'anti-sniping',
      }),
      closed(a.lotId, BEN, '120.00'),
      buildEvent('AuctionClosed', TENANT, { auctionId: a.auctionId }),
    ];
    for (const e of log) await apply(e);
    const first = await snapshot();

    await resetProjection(prisma);
    expect(await prisma.lot.count()).toBe(0);
    for (const e of log) await apply(e);

    expect(await snapshot()).toEqual(first);
  });
});
