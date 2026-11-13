import { randomUUID } from 'node:crypto';
import { applyEventToProjection, createPrismaClient } from '@bidstream/db';
import {
  buildEvent,
  compareBids,
  foldLot,
  formatMoney,
  minimumBid,
  parseMoney,
  type DomainEvent,
  type EventOf,
} from '@bidstream/domain';
import { createTestDatabase, generateHistory, type TestDatabase } from '@bidstream/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import type { ReadDb } from './context.js';
import { buildHttpServer, buildYoga } from './server.js';

// GraphQL contra PostgreSQL real. La proyección se puebla aplicando un historial generado con el mismo
// código que usa el projector, de modo que lo que se lee es lo que el dominio calcula (foldLot).
const config = loadConfig({
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
});
const history = generateHistory({ seed: 42, auctions: 2, lotsPerAuction: 3, bidsPerLot: 8 });
const TENANT = history[0]?.tenantId ?? '';
const OTHER = '99999999-9999-4999-8999-999999999999';

let db: TestDatabase;
let prisma: ReturnType<typeof createPrismaClient>;
let yoga: ReturnType<typeof buildYoga>;
let calls = 0;

/** Cuenta las lecturas a la base de datos: cada llamada a un modelo es una consulta. */
function counting(real: ReadDb): ReadDb {
  const wrap = <T extends object>(delegate: T): T =>
    new Proxy(delegate, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          calls += 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  return { auction: wrap(real.auction), lot: wrap(real.lot), bid: wrap(real.bid) };
}

beforeAll(async () => {
  db = await createTestDatabase();
  prisma = createPrismaClient(db.url);
  for (const event of history) await prisma.$transaction((tx) => applyEventToProjection(tx, event));
  yoga = buildYoga({ config, db: counting(prisma) });
});
afterAll(async () => {
  await prisma.$disconnect();
  await db.drop();
});

interface Reply {
  readonly status: number;
  readonly body: {
    data?: Record<string, unknown> | null;
    errors?: { message: string; extensions?: { code?: string } }[];
  };
}

async function gql(
  query: string,
  options: {
    variables?: object;
    tenant?: string | null;
    yogaInstance?: ReturnType<typeof buildYoga>;
  } = {},
): Promise<Reply> {
  const tenant = options.tenant === undefined ? TENANT : options.tenant;
  const response = await (options.yogaInstance ?? yoga).fetch('http://localhost/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(tenant === null ? {} : { 'x-tenant-id': tenant }),
    },
    body: JSON.stringify({ query, variables: options.variables }),
  });
  return { status: response.status, body: (await response.json()) as Reply['body'] };
}

const lotIdsOf = (events: DomainEvent[]): string[] =>
  events.filter((e) => e.type === 'LotPublished').map((e) => e.payload.lotId);
const eventsOfLot = (lotId: string): DomainEvent[] =>
  history.filter((e) => 'lotId' in e.payload && e.payload.lotId === lotId);
const auctionIds = history
  .filter((e) => e.type === 'AuctionOpened')
  .map((e) => e.payload.auctionId);

describe('Lot', () => {
  it('todos los lotes coinciden con el estado que calcula el dominio (foldLot)', async () => {
    for (const lotId of lotIdsOf(history)) {
      const state = foldLot(eventsOfLot(lotId));
      if (state === undefined) throw new Error('lote esperado');
      const { body } = await gql(
        `query($id: ID!) { lot(id: $id) { id title startingPrice minIncrement currency closesAt currentPrice
           status hasWinner finalAmount nextMinimumBid } }`,
        { variables: { id: lotId } },
      );
      expect(body.errors).toBeUndefined();
      expect(body.data?.['lot']).toEqual({
        id: lotId,
        title: expect.any(String) as string,
        startingPrice: formatMoney(state.startingPrice),
        minIncrement: formatMoney(state.minIncrement),
        currency: state.currency,
        closesAt: state.closesAt.toISOString(),
        currentPrice: state.currentPrice === null ? null : formatMoney(state.currentPrice),
        status: state.status === 'open' ? 'OPEN' : 'CLOSED',
        hasWinner: state.winnerId !== null,
        finalAmount: state.finalAmount === null ? null : formatMoney(state.finalAmount),
        nextMinimumBid: formatMoney(minimumBid(state)),
      });
    }
  });

  it('el dinero es una cadena con dos decimales y las fechas son ISO en UTC', async () => {
    const lotId = lotIdsOf(history)[0] ?? '';
    const { body } = await gql(`query($id: ID!) { lot(id: $id) { startingPrice closesAt } }`, {
      variables: { id: lotId },
    });
    const lot = body.data?.['lot'] as { startingPrice: string; closesAt: string };
    expect(lot.startingPrice).toMatch(/^\d+\.\d{2}$/);
    expect(lot.closesAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('nextMinimumBid: sin pujas es el precio de salida y con pujas el vigente más el incremento', async () => {
    const auctionId = randomUUID();
    const lotId = randomUUID();
    const t = '2030-01-02T10:00:00.000Z';
    for (const e of [
      buildEvent('AuctionOpened', TENANT, {
        auctionId,
        title: 'X',
        opensAt: '2030-01-01T10:00:00.000Z',
        closesAt: t,
      }),
      buildEvent('LotPublished', TENANT, {
        lotId,
        auctionId,
        title: 'Y',
        startingPrice: '100.00',
        minIncrement: '5.00',
        currency: 'USD',
        closesAt: t,
      }),
    ]) {
      await prisma.$transaction((tx) => applyEventToProjection(tx, e));
    }
    const read = async (): Promise<string> =>
      (
        (
          await gql(`query($id: ID!) { lot(id: $id) { nextMinimumBid } }`, {
            variables: { id: lotId },
          })
        ).body.data?.['lot'] as { nextMinimumBid: string }
      ).nextMinimumBid;
    expect(await read()).toBe('100.00');
    await prisma.$transaction((tx) =>
      applyEventToProjection(
        tx,
        buildEvent('BidPlaced', TENANT, {
          lotId,
          bidderId: '44444444-4444-4444-8444-444444444444',
          amount: '120.00',
          placedAt: '2030-01-01T11:00:00.000Z',
        }),
      ),
    );
    expect(await read()).toBe('125.00');
  });
});

describe('aislamiento y tenant', () => {
  it('un lote o una subasta de otro tenant, o inexistente, devuelve null', async () => {
    const lotId = lotIdsOf(history)[0] ?? '';
    for (const tenant of [OTHER]) {
      const lot = await gql(`query($id: ID!) { lot(id: $id) { id } }`, {
        variables: { id: lotId },
        tenant,
      });
      expect(lot.body.data?.['lot']).toBeNull();
      const auction = await gql(`query($id: ID!) { auction(id: $id) { id } }`, {
        variables: { id: auctionIds[0] },
        tenant,
      });
      expect(auction.body.data?.['auction']).toBeNull();
    }
    const missing = await gql(`query($id: ID!) { lot(id: $id) { id } }`, {
      variables: { id: randomUUID() },
    });
    expect(missing.body.data?.['lot']).toBeNull();
  });

  it('lotBids de un lote de otro tenant devuelve una conexión vacía', async () => {
    const { body } = await gql(
      `query($id: ID!) { lotBids(lotId: $id) { edges { cursor } pageInfo { hasNextPage endCursor } } }`,
      { variables: { id: lotIdsOf(history)[0] }, tenant: OTHER },
    );
    expect(body.data?.['lotBids']).toEqual({
      edges: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });

  it('sin cabecera de tenant → UNAUTHENTICATED (401); con un tenant que no es UUID → BAD_USER_INPUT', async () => {
    const missing = await gql('{ lot(id: "x") { id } }', { tenant: null });
    expect(missing.status).toBe(401);
    expect(missing.body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    const bad = await gql('{ lot(id: "x") { id } }', { tenant: 'no-es-uuid' });
    expect(bad.status).toBe(400);
    expect(bad.body.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });
});

describe('activeLots', () => {
  it('devuelve solo los lotes abiertos, por orden de cierre, y respeta first', async () => {
    const auctionId = randomUUID();
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const opened = buildEvent('AuctionOpened', TENANT, {
      auctionId,
      title: 'Activa',
      opensAt: '2030-01-01T10:00:00.000Z',
      closesAt: '2030-02-01T10:00:00.000Z',
    });
    const lot = (lotId: string, closesAt: string): DomainEvent =>
      buildEvent('LotPublished', TENANT, {
        lotId,
        auctionId,
        title: lotId.slice(0, 4),
        startingPrice: '10.00',
        minIncrement: '1.00',
        currency: 'USD',
        closesAt,
      });
    const events = [
      opened,
      lot(ids[0] ?? '', '2030-01-03T00:00:00.000Z'),
      lot(ids[1] ?? '', '2030-01-02T00:00:00.000Z'),
      lot(ids[2] ?? '', '2030-01-04T00:00:00.000Z'),
      buildEvent('LotClosed', TENANT, { lotId: ids[2] ?? '', winnerId: null, finalAmount: null }),
    ];
    for (const e of events) await prisma.$transaction((tx) => applyEventToProjection(tx, e));

    const all = await gql(`query($a: ID!) { activeLots(auctionId: $a) { id status } }`, {
      variables: { a: auctionId },
    });
    expect(all.body.data?.['activeLots']).toEqual([
      { id: ids[1], status: 'OPEN' },
      { id: ids[0], status: 'OPEN' },
    ]);
    const one = await gql(`query($a: ID!) { activeLots(auctionId: $a, first: 1) { id } }`, {
      variables: { a: auctionId },
    });
    expect(one.body.data?.['activeLots']).toEqual([{ id: ids[1] }]);
  });
});

describe('lotBids: paginación por cursor', () => {
  const bidsQuery = `query($id: ID!, $first: Int, $after: String) {
    lotBids(lotId: $id, first: $first, after: $after) {
      edges { cursor node { id amount placedAt rank awarded } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  interface Page {
    edges: {
      cursor: string;
      node: { id: string; amount: string; placedAt: string; rank: number };
    }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  }

  async function allPages(lotId: string, first: number): Promise<Page['edges']> {
    const collected: Page['edges'] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 100; guard++) {
      const { body } = await gql(bidsQuery, { variables: { id: lotId, first, after } });
      expect(body.errors).toBeUndefined();
      const page = body.data?.['lotBids'] as Page;
      collected.push(...page.edges);
      if (!page.pageInfo.hasNextPage) return collected;
      after = page.pageInfo.endCursor;
    }
    throw new Error('la paginación no termina');
  }

  it('recorrer todas las páginas reproduce el ranking del dominio (compareBids), sin repetir ni omitir', async () => {
    const lotId =
      lotIdsOf(history).sort(
        (a, b) =>
          history.filter((e) => e.type === 'BidPlaced' && e.payload.lotId === b).length -
          history.filter((e) => e.type === 'BidPlaced' && e.payload.lotId === a).length,
      )[0] ?? '';
    const placed = history.filter(
      (e): e is EventOf<'BidPlaced'> => e.type === 'BidPlaced' && e.payload.lotId === lotId,
    );
    expect(placed.length).toBeGreaterThan(3);

    const edges = await allPages(lotId, 3);
    const expected = placed
      .map((e) => ({
        id: e.eventId,
        amount: parseMoney(e.payload.amount),
        placedAt: new Date(e.payload.placedAt),
      }))
      .sort(compareBids)
      .map((b) => b.id);
    expect(edges.map((e) => e.node.id)).toEqual(expected);
    expect(new Set(edges.map((e) => e.node.id)).size).toBe(edges.length);
    expect(edges.map((e) => e.node.rank)).toEqual(edges.map((_, i) => i + 1));
  });

  it('el tamaño de página no cambia el resultado', async () => {
    const lotId = lotIdsOf(history)[0] ?? '';
    const small = await allPages(lotId, 1);
    const big = await allPages(lotId, 50);
    expect(small.map((e) => e.node.id)).toEqual(big.map((e) => e.node.id));
  });

  it('con montos iguales ordena por antigüedad y luego por id, y el cursor no confunde los empates', async () => {
    const auctionId = randomUUID();
    const lotId = randomUUID();
    await prisma.auction.create({
      data: {
        id: auctionId,
        tenantId: TENANT,
        title: 'Empates',
        opensAt: new Date(),
        closesAt: new Date(Date.now() + 1e9),
        status: 'OPEN',
      },
    });
    await prisma.lot.create({
      data: {
        id: lotId,
        auctionId,
        tenantId: TENANT,
        title: 'E',
        startingPrice: '1.00',
        minIncrement: '1.00',
        currency: 'USD',
        closesAt: new Date(Date.now() + 1e9),
        status: 'OPEN',
      },
    });
    const t1 = new Date('2030-01-01T10:00:00.000Z');
    const t2 = new Date('2030-01-01T10:00:01.000Z');
    const rows = [
      { id: '00000000-0000-4000-8000-00000000000b', amount: '50.00', placedAt: t2 },
      { id: '00000000-0000-4000-8000-00000000000a', amount: '50.00', placedAt: t2 },
      { id: '00000000-0000-4000-8000-00000000000c', amount: '50.00', placedAt: t1 },
      { id: '00000000-0000-4000-8000-00000000000d', amount: '60.00', placedAt: t2 },
    ];
    for (const r of rows) {
      await prisma.bid.create({
        data: { ...r, lotId, bidderId: '44444444-4444-4444-8444-444444444444' },
      });
    }
    const expected = [
      '00000000-0000-4000-8000-00000000000d', // mayor monto
      '00000000-0000-4000-8000-00000000000c', // mismo monto, más antigua
      '00000000-0000-4000-8000-00000000000a', // mismo instante: menor id
      '00000000-0000-4000-8000-00000000000b',
    ];
    expect((await allPages(lotId, 1)).map((e) => e.node.id)).toEqual(expected);
    expect((await allPages(lotId, 2)).map((e) => e.node.id)).toEqual(expected);
  });

  it('la conexión desde Lot.bids es la misma que lotBids', async () => {
    const lotId = lotIdsOf(history)[0] ?? '';
    const direct = await gql(bidsQuery, { variables: { id: lotId, first: 4 } });
    const nested = await gql(
      `query($id: ID!) { lot(id: $id) { bids(first: 4) { edges { cursor node { id } } pageInfo { hasNextPage endCursor } } } }`,
      { variables: { id: lotId } },
    );
    const a = (direct.body.data?.['lotBids'] as Page).edges.map((e) => e.node.id);
    const b = (nested.body.data?.['lot'] as { bids: Page }).bids.edges.map((e) => e.node.id);
    expect(b).toEqual(a);
  });

  it.each([
    ['first = 101', { first: 101 }],
    ['first = 0', { first: 0 }],
    ['first = -5', { first: -5 }],
    ['cursor que no es base64', { first: 5, after: '!!!' }],
    ['cursor con otra forma', { first: 5, after: Buffer.from('{"a":1}').toString('base64url') }],
  ])('rechaza %s con BAD_USER_INPUT', async (_name, vars) => {
    const lotId = lotIdsOf(history)[0] ?? '';
    const { body } = await gql(bidsQuery, { variables: { id: lotId, ...vars } });
    expect(body.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });

  it('un ID que no es UUID se rechaza antes de tocar la base de datos', async () => {
    calls = 0;
    const { body } = await gql(`{ lot(id: "no-es-uuid") { id } }`);
    expect(body.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    expect(calls).toBe(0);
  });
});

describe('N+1, privacidad y errores', () => {
  it('una consulta anidada hace un número acotado de lecturas, no una por elemento', async () => {
    calls = 0;
    const { body } = await gql(
      `query($a: ID!) { auction(id: $a) { id lots(first: 50) { id auction { id } bids(first: 1) { edges { cursor } } } } }`,
      { variables: { a: auctionIds[0] } },
    );
    expect(body.errors).toBeUndefined();
    const lots = (body.data?.['auction'] as { lots: unknown[] }).lots;
    expect(lots.length).toBeGreaterThanOrEqual(3);
    // 1 subasta + 1 lotes (loader) + 2 por conexión de pujas (lote + pujas) × lotes: las pujas son por lote
    // pero subasta y lotes se cargan en lote. Sin DataLoader serían al menos 2 por lote adicionales.
    expect(calls).toBeLessThanOrEqual(2 + lots.length * 2);
    const withoutBids = calls;
    calls = 0;
    await gql(`query($a: ID!) { auction(id: $a) { lots(first: 50) { id auction { id } } } }`, {
      variables: { a: auctionIds[0] },
    });
    expect(calls).toBeLessThanOrEqual(2); // subasta + lotes, y la subasta de cada lote sale del caché
    expect(withoutBids).toBeGreaterThan(calls);
  });

  it('el esquema no tiene ningún campo con la identidad de postores o ganadores', async () => {
    const { body } = await gql(`{ __schema { types { name fields { name } } } }`);
    const types = (
      body.data?.['__schema'] as { types: { name: string; fields: { name: string }[] | null }[] }
    ).types;
    const names = types.flatMap((t) => (t.fields ?? []).map((f) => f.name));
    // `hasWinner` (en Lot y en LotClosedUpdate) es lo único permitido: un booleano, nunca la identidad.
    expect([...new Set(names.filter((n) => /bidder|winner/i.test(n)))]).toEqual(['hasWinner']);
  });

  it('un error interno se enmascara: el cliente no ve ni el mensaje ni la traza', async () => {
    const broken = buildYoga({
      config,
      db: {
        ...counting(prisma),
        lot: {
          findFirst: () => {
            throw new Error('password=hunter2 en postgresql://u:secreto@host/db');
          },
        } as unknown as ReadDb['lot'],
      },
    });
    const { body } = await gql(`{ lot(id: "${randomUUID()}") { id } }`, { yogaInstance: broken });
    const text = JSON.stringify(body);
    expect(body.errors?.[0]?.message).toBe('Unexpected error.');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('secreto');
    expect(text).not.toMatch(/\bat .*\.(ts|js):\d+/);
  });
});

describe('servidor HTTP', () => {
  it('GET /health responde 200 y /graphql sirve consultas por HTTP real', async () => {
    const server = buildHttpServer({ config, db: prisma });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      const health = await fetch(`http://127.0.0.1:${String(port)}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: 'ok' });

      const res = await fetch(`http://127.0.0.1:${String(port)}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': TENANT },
        body: JSON.stringify({
          query: `{ activeLots(auctionId: "${auctionIds[0] ?? ''}") { id } }`,
        }),
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { errors?: unknown }).errors).toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      });
    }
  });
});
