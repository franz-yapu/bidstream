import { randomUUID } from 'node:crypto';
import {
  buildEvent,
  evolveAuction,
  foldLot,
  formatMoney,
  partitionKey,
  type AuctionState,
  type EventDraft,
  type LotState,
} from '@bidstream/domain';
import { createTestDatabase, type TestDatabase } from '@bidstream/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrismaClient,
  PrismaAuctionRepository,
  PrismaLotRepository,
  PrismaOutbox,
  withTransaction,
} from '../index.js';

// Repositorios contra el PostgreSQL de `make up` (base desechable de @bidstream/testing). El estado
// que leen se compara con el que reconstruye el dominio (`foldLot`) del mismo historial: si se
// desalinean, el lado de comandos leería algo distinto de lo que construye el projector.
const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '99999999-9999-4999-8999-999999999999';
const ANA = '44444444-4444-4444-8444-444444444444';
const BEN = '55555555-5555-4555-8555-555555555555';
const T0 = '2026-11-12T20:00:00.000Z';
const T1 = '2026-11-12T20:05:00.000Z';
const id = (): string => randomUUID();

let db: TestDatabase;
// Cliente creado desde este paquete (src): el de @bidstream/testing viene de dist y TypeScript los
// trata como clases distintas.
let prisma: ReturnType<typeof createPrismaClient>;
let lots: PrismaLotRepository;
let auctions: PrismaAuctionRepository;

beforeAll(async () => {
  db = await createTestDatabase();
  prisma = createPrismaClient(db.url);
  lots = new PrismaLotRepository(prisma);
  auctions = new PrismaAuctionRepository(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
  await db.drop();
});

async function seedAuction(
  auctionId = id(),
  tenantId = TENANT,
  status: 'OPEN' | 'CLOSED' = 'OPEN',
): Promise<string> {
  await prisma.auction.create({
    data: {
      id: auctionId,
      tenantId,
      title: 'Arte',
      opensAt: new Date('2026-11-12T10:00:00Z'),
      closesAt: new Date(T0),
      status,
    },
  });
  return auctionId;
}

function published(lotId: string, auctionId: string): EventDraft {
  return {
    type: 'LotPublished',
    payload: {
      lotId,
      auctionId,
      title: 'Óleo',
      startingPrice: '100.00',
      minIncrement: '5.00',
      currency: 'USD',
      closesAt: T0,
    },
  };
}

const bid = (lotId: string, bidderId: string, amount: string): EventDraft => ({
  type: 'BidPlaced',
  payload: { lotId, bidderId, amount, placedAt: '2026-11-12T19:00:00.000Z' },
});

/** Inserta el lote tal como lo dejaría el projector tras el historial dado. */
async function seedLot(drafts: EventDraft[], tenantId = TENANT): Promise<LotState> {
  const state = foldLot(drafts);
  if (state === undefined) throw new Error('el historial debe empezar con LotPublished');
  await prisma.lot.create({
    data: {
      id: state.lotId,
      auctionId: state.auctionId,
      tenantId,
      title: 'Óleo',
      startingPrice: formatMoney(state.startingPrice),
      minIncrement: formatMoney(state.minIncrement),
      currency: state.currency,
      closesAt: state.closesAt,
      currentPrice: state.currentPrice === null ? null : formatMoney(state.currentPrice),
      currentBidder: state.currentBidderId,
      status: state.status === 'open' ? 'OPEN' : 'CLOSED',
      winnerId: state.winnerId,
    },
  });
  return state;
}

describe('PrismaLotRepository', () => {
  it('lote abierto sin pujas: dinero en centavos, fechas y precio vigente nulo', async () => {
    const auctionId = await seedAuction();
    const lotId = id();
    const expected = await seedLot([published(lotId, auctionId)]);
    expect(await lots.findById(TENANT, lotId)).toEqual(expected);
    expect(expected.startingPrice).toBe(10000n);
  });

  it('lote con pujas y extensión: coincide con foldLot', async () => {
    const auctionId = await seedAuction();
    const lotId = id();
    const expected = await seedLot([
      published(lotId, auctionId),
      bid(lotId, ANA, '100.00'),
      bid(lotId, BEN, '105.50'),
      { type: 'LotExtended', payload: { lotId, newClosesAt: T1, reason: 'anti-sniping' } },
    ]);
    const found = await lots.findById(TENANT, lotId);
    expect(found).toEqual(expected);
    expect(found?.currentPrice).toBe(10550n);
    expect(found?.closesAt).toEqual(new Date(T1));
  });

  it('lote cerrado con ganador: winnerId y finalAmount coinciden con foldLot', async () => {
    const auctionId = await seedAuction();
    const lotId = id();
    const expected = await seedLot([
      published(lotId, auctionId),
      bid(lotId, BEN, '150.00'),
      { type: 'LotClosed', payload: { lotId, winnerId: BEN, finalAmount: '150.00' } },
    ]);
    const found = await lots.findById(TENANT, lotId);
    expect(found).toEqual(expected);
    expect(found).toMatchObject({ status: 'closed', winnerId: BEN, finalAmount: 15000n });
  });

  it('lote cerrado desierto: winnerId y finalAmount nulos', async () => {
    const auctionId = await seedAuction();
    const lotId = id();
    const expected = await seedLot([
      published(lotId, auctionId),
      { type: 'LotClosed', payload: { lotId, winnerId: null, finalAmount: null } },
    ]);
    const found = await lots.findById(TENANT, lotId);
    expect(found).toEqual(expected);
    expect(found).toMatchObject({ status: 'closed', winnerId: null, finalAmount: null });
  });

  it('un lote de otro tenant o inexistente devuelve null', async () => {
    const auctionId = await seedAuction(id(), OTHER_TENANT);
    const lotId = id();
    await seedLot([published(lotId, auctionId)], OTHER_TENANT);
    expect(await lots.findById(OTHER_TENANT, lotId)).not.toBeNull();
    expect(await lots.findById(TENANT, lotId)).toBeNull();
    expect(await lots.findById(TENANT, id())).toBeNull();
  });
});

describe('PrismaAuctionRepository', () => {
  it('devuelve openLotIds solo con los lotes abiertos de esa subasta', async () => {
    const auctionId = await seedAuction();
    const otherAuction = await seedAuction();
    const open1 = id();
    const open2 = id();
    const closed = id();
    const foreign = id();
    await seedLot([published(open1, auctionId)]);
    await seedLot([published(open2, auctionId)]);
    await seedLot([
      published(closed, auctionId),
      { type: 'LotClosed', payload: { lotId: closed, winnerId: null, finalAmount: null } },
    ]);
    await seedLot([published(foreign, otherAuction)]);

    const found = await auctions.findById(TENANT, auctionId);
    expect(found?.status).toBe('open');
    expect([...(found?.openLotIds ?? [])].sort()).toEqual([open1, open2].sort());
  });

  it('coincide con evolveAuction del mismo historial', async () => {
    const auctionId = await seedAuction();
    const lotId = id();
    await seedLot([published(lotId, auctionId)]);
    const history: EventDraft[] = [
      {
        type: 'AuctionOpened',
        payload: {
          auctionId,
          title: 'Arte',
          opensAt: '2026-11-12T10:00:00.000Z',
          closesAt: T0,
        },
      },
      published(lotId, auctionId),
    ];
    const expected = history.reduce<AuctionState | undefined>(evolveAuction, undefined);
    expect(await auctions.findById(TENANT, auctionId)).toEqual(expected);
  });

  it('una subasta de otro tenant o inexistente devuelve null', async () => {
    const auctionId = await seedAuction(id(), OTHER_TENANT);
    expect(await auctions.findById(TENANT, auctionId)).toBeNull();
    expect(await auctions.findById(TENANT, id())).toBeNull();
  });
});

describe('PrismaOutbox', () => {
  const event = (auctionId = id()): ReturnType<typeof buildEvent<'AuctionClosed'>> =>
    buildEvent('AuctionClosed', TENANT, { auctionId });

  it('escribe filas con id = eventId, key = partitionKey y el evento como payload', async () => {
    const outbox = new PrismaOutbox(prisma);
    const e1 = event();
    const e2 = buildEvent('LotClosed', TENANT, {
      lotId: id(),
      winnerId: null,
      finalAmount: null,
    });
    await outbox.enqueue([e1, e2], 'bidstream.events.lot');

    const rows = await prisma.outboxMessage.findMany({
      where: { id: { in: [e1.eventId, e2.eventId] } },
      orderBy: { id: 'asc' },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const source = row.id === e1.eventId ? e1 : e2;
      expect(row).toMatchObject({
        topic: 'bidstream.events.lot',
        key: partitionKey(source),
        publishedAt: null,
      });
      expect(row.payload).toEqual(JSON.parse(JSON.stringify(source)));
    }
  });

  it('no hace nada con una lista vacía', async () => {
    const before = await prisma.outboxMessage.count();
    await new PrismaOutbox(prisma).enqueue([], 'bidstream.events.lot');
    expect(await prisma.outboxMessage.count()).toBe(before);
  });

  it('reenviar el mismo evento falla por clave primaria (no duplica)', async () => {
    const outbox = new PrismaOutbox(prisma);
    const e = event();
    await outbox.enqueue([e], 'bidstream.events.lot');
    await expect(outbox.enqueue([e], 'bidstream.events.lot')).rejects.toThrow();
    expect(await prisma.outboxMessage.count({ where: { id: e.eventId } })).toBe(1);
  });

  it('un lote de eventos es todo o nada', async () => {
    const outbox = new PrismaOutbox(prisma);
    const fresh = event();
    const taken = event();
    await outbox.enqueue([taken], 'bidstream.events.lot');
    await expect(outbox.enqueue([fresh, taken], 'bidstream.events.lot')).rejects.toThrow();
    expect(await prisma.outboxMessage.count({ where: { id: fresh.eventId } })).toBe(0);
  });
});

describe('withTransaction', () => {
  const countOutbox = async (eventId: string): Promise<number> => {
    const { rows } = await db.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM outbox_message WHERE id = $1',
      [eventId],
    );
    return rows[0]?.n ?? 0;
  };

  it('si el trabajo lanza después de encolar, no queda nada en el outbox (spec §5)', async () => {
    const e = buildEvent('AuctionClosed', TENANT, { auctionId: id() });
    await expect(
      withTransaction(prisma, async ({ outbox }) => {
        await outbox.enqueue([e], 'bidstream.events.lot');
        throw new Error('el comando falló');
      }),
    ).rejects.toThrow('el comando falló');
    expect(await countOutbox(e.eventId)).toBe(0);
  });

  it('lectura y outbox se confirman a la vez al terminar bien', async () => {
    const auctionId = await seedAuction();
    const lotId = id();
    await seedLot([published(lotId, auctionId)]);
    const e = buildEvent('AuctionClosed', TENANT, { auctionId });

    const result = await withTransaction(prisma, async ({ lots: txLots, outbox }) => {
      const lot = await txLots.findById(TENANT, lotId);
      await outbox.enqueue([e], 'bidstream.events.lot');
      // desde otra conexión, aún no se ve nada: la transacción no está confirmada
      expect(await countOutbox(e.eventId)).toBe(0);
      return lot?.lotId;
    });

    expect(result).toBe(lotId);
    expect(await countOutbox(e.eventId)).toBe(1);
  });
});
