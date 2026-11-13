import { randomUUID } from 'node:crypto';
import { applyEventToProjection, createPrismaClient } from '@bidstream/db';
import { generateHistory, createTestDatabase, type TestDatabase } from '@bidstream/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import type { ReadDb } from './context.js';
import { buildYoga } from './server.js';

// Los límites a nivel de servidor: cada abuso se rechaza antes de ejecutar ningún resolver, y la
// consulta legítima pasa. La base de datos «inalcanzable» cuenta cualquier intento de usarla.
const history = generateHistory({ seed: 42, auctions: 2, lotsPerAuction: 3, bidsPerLot: 8 });
const TENANT = history[0]?.tenantId ?? '';
const AUCTION = history.find((e) => e.type === 'AuctionOpened')?.payload;
const AUCTION_ID = AUCTION !== undefined && 'auctionId' in AUCTION ? AUCTION.auctionId : '';
const LOT_ID = history.find((e) => e.type === 'LotPublished')?.payload;
const lotId = LOT_ID !== undefined && 'lotId' in LOT_ID ? LOT_ID.lotId : '';

const env = {
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
};

let db: TestDatabase;
let prisma: ReturnType<typeof createPrismaClient>;
let touched = 0;
const unreachable = new Proxy(
  {},
  {
    get() {
      touched += 1;
      throw new Error('este documento no debía llegar a la base de datos');
    },
  },
) as unknown as ReadDb;

beforeAll(async () => {
  db = await createTestDatabase();
  prisma = createPrismaClient(db.url);
  for (const e of history) await prisma.$transaction((tx) => applyEventToProjection(tx, e));
});
afterAll(async () => {
  await prisma.$disconnect();
  await db.drop();
});

type Yoga = ReturnType<typeof buildYoga>;
interface Reply {
  status: number;
  body: {
    data?: Record<string, unknown> | null;
    errors?: { message: string; extensions?: Record<string, unknown> }[];
  };
}

async function send(
  yoga: Yoga,
  body: string,
  headers: Record<string, string> = {},
): Promise<Reply> {
  const response = await yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    // Con `Accept: application/graphql-response+json` (GraphQL sobre HTTP) los errores de validación
    // devuelven 400; con `application/json` Yoga mantiene el 200 histórico.
    headers: {
      'content-type': 'application/json',
      accept: 'application/graphql-response+json, application/json',
      'x-tenant-id': TENANT,
      ...headers,
    },
    body,
  });
  return { status: response.status, body: (await response.json()) as Reply['body'] };
}
const gql = (yoga: Yoga, query: string, variables?: object): Promise<Reply> =>
  send(yoga, JSON.stringify({ query, variables }));
const rejects = (reply: Reply, code: string): void => {
  expect(reply.body.errors?.[0]?.extensions?.['code']).toBe(code);
};

describe('rechazos: ningún resolver se ejecuta', () => {
  const yoga = buildYoga({ config: loadConfig(env), db: unreachable });

  it('profundidad 8 → QUERY_TOO_DEEP (400) con el límite y el valor en el mensaje', async () => {
    touched = 0;
    const reply = await gql(
      yoga,
      `{ auction(id: "${AUCTION_ID}") { lots { auction { lots { auction { lots { auction { id } } } } } } } }`,
    );
    expect(reply.status).toBe(400);
    rejects(reply, 'QUERY_TOO_DEEP');
    expect(reply.body.errors?.[0]?.message).toMatch(/profundidad 8.*máximo es 7/);
    expect(touched).toBe(0);
  });

  it('complejidad excesiva → QUERY_TOO_COMPLEX', async () => {
    touched = 0;
    const reply = await gql(
      yoga,
      `{ activeLots(auctionId: "${AUCTION_ID}", first: 100) { bids(first: 100) { edges { node { id } } } } }`,
    );
    rejects(reply, 'QUERY_TOO_COMPLEX');
    expect(reply.body.errors?.[0]?.message).toMatch(/complejidad 30100.*máximo es 1000/);
    expect(reply.status).toBe(400);
    expect(touched).toBe(0);
  });

  it('first enorme pasado por variable también se rechaza por complejidad', async () => {
    touched = 0;
    const reply = await gql(
      yoga,
      `query($n: Int) { activeLots(auctionId: "${AUCTION_ID}", first: $n) { id } }`,
      { n: 100_000 },
    );
    rejects(reply, 'QUERY_TOO_COMPLEX');
    expect(touched).toBe(0);
  });

  it('16 alias → TOO_MANY_ALIASES', async () => {
    touched = 0;
    const aliases = Array.from(
      { length: 16 },
      (_, i) => `a${String(i)}: lot(id: "${lotId}") { id }`,
    ).join(' ');
    const reply = await gql(yoga, `{ ${aliases} }`);
    expect(reply.status).toBe(400);
    rejects(reply, 'TOO_MANY_ALIASES');
    expect(touched).toBe(0);
  });

  it('un documento con más de 2 000 tokens → QUERY_TOO_LARGE', async () => {
    touched = 0;
    const reply = await gql(yoga, `{ lot(id: "x") { ${'id '.repeat(2_500)} } }`);
    expect(reply.status).toBe(400);
    rejects(reply, 'QUERY_TOO_LARGE');
    expect(reply.body.errors?.[0]?.message).toMatch(/2000 tokens/);
    expect(touched).toBe(0);
  });

  it('un cuerpo de más de 100 KB → 413 QUERY_TOO_LARGE sin analizarlo', async () => {
    touched = 0;
    const reply = await send(
      yoga,
      JSON.stringify({ query: '{ lot(id: "x") { id } }', padding: 'x'.repeat(110_000) }),
    );
    expect(reply.status).toBe(413);
    rejects(reply, 'QUERY_TOO_LARGE');
    expect(touched).toBe(0);
  });

  it('un lote de consultas (array JSON) no se admite', async () => {
    touched = 0;
    const reply = await send(
      yoga,
      JSON.stringify([{ query: '{ lot(id: "x") { id } }' }, { query: '{ lot(id: "y") { id } }' }]),
    );
    expect(reply.status).toBeGreaterThanOrEqual(400);
    expect(reply.body.errors).toBeDefined();
    expect(reply.body.data).toBeUndefined();
    expect(touched).toBe(0);
  });
});

describe('lo legítimo pasa', () => {
  // `prisma` se asigna en beforeAll: el servidor se crea al usarlo.
  const live = (config = loadConfig(env)): Yoga => buildYoga({ config, db: prisma });

  it('la consulta de referencia (coste 42) devuelve datos', async () => {
    const reply = await gql(
      live(),
      `query($id: ID!) { lot(id: $id) { title auction { lots(first: 10) { title } } bids(first: 10) { edges { node { amount rank } } } } }`,
      { id: lotId },
    );
    expect(reply.body.errors).toBeUndefined();
    const lot = reply.body.data?.['lot'] as {
      auction: { lots: unknown[] };
      bids: { edges: unknown[] };
    };
    expect(lot.auction.lots.length).toBeGreaterThan(0);
    expect(lot.bids.edges.length).toBeGreaterThan(0);
  });

  it('exactamente 15 alias y profundidad 7 pasan', async () => {
    const aliases = Array.from(
      { length: 15 },
      (_, i) => `a${String(i)}: lot(id: "${lotId}") { id }`,
    ).join(' ');
    const reply = await gql(live(), `{ ${aliases} }`);
    expect(reply.body.errors).toBeUndefined();
    const deep = await gql(
      live(),
      `{ auction(id: "${AUCTION_ID}") { lots(first: 2) { auction { lots(first: 2) { auction { lots(first: 2) { id } } } } } } }`,
    );
    expect(deep.body.errors).toBeUndefined();
  });

  it('los límites se pueden ajustar por entorno', async () => {
    const strict = live(loadConfig({ ...env, GQL_MAX_DEPTH: '2' }));
    rejects(
      await gql(strict, `{ auction(id: "${AUCTION_ID}") { lots { id } } }`),
      'QUERY_TOO_DEEP',
    );
    const loose = live(loadConfig({ ...env, GQL_MAX_DEPTH: '12' }));
    const reply = await gql(
      loose,
      `{ auction(id: "${AUCTION_ID}") { lots(first: 1) { auction { lots(first: 1) { auction { lots(first: 1) { auction { lots(first: 1) { auction { id } } } } } } } } } }`,
    );
    expect(reply.body.errors).toBeUndefined();
  });
});

describe('política de introspección y errores', () => {
  const introspection = '{ __schema { types { name } } }';

  it('activa por defecto fuera de producción', async () => {
    const reply = await gql(buildYoga({ config: loadConfig(env), db: unreachable }), introspection);
    expect(reply.body.errors).toBeUndefined();
    expect((reply.body.data?.['__schema'] as { types: unknown[] }).types.length).toBeGreaterThan(5);
  });

  it('se rechaza cuando se desactiva (GQL_INTROSPECTION=false)', async () => {
    touched = 0;
    const yoga = buildYoga({
      config: loadConfig({ ...env, GQL_INTROSPECTION: 'false' }),
      db: unreachable,
    });
    const reply = await gql(yoga, introspection);
    expect(reply.status).toBe(400);
    expect(reply.body.errors?.[0]?.message).toMatch(/introspection/i);
    expect(touched).toBe(0);
  });

  it('los mensajes de error no contienen trazas ni rutas internas', async () => {
    const yoga = buildYoga({ config: loadConfig(env), db: unreachable });
    const reply = await gql(
      yoga,
      `{ a: lot(id: "${randomUUID()}") { id } ${'b: lot(id: "x") { id } '.repeat(20)} }`,
    );
    const text = JSON.stringify(reply.body);
    expect(text).not.toMatch(/\bat .*\.(ts|js):\d+/);
    expect(text).not.toContain('node_modules');
  });
});
