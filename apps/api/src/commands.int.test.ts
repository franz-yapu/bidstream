import { randomUUID } from 'node:crypto';
import {
  FixedClock,
  parseEvent,
  partitionKey,
  type DomainEvent,
  type IdGenerator,
} from '@bidstream/domain';
import { createTestDatabase, type TestDatabase } from '@bidstream/testing';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { Uuid7Generator } from './system.js';
import { HeaderTenantResolver } from './tenant.js';

// Comandos contra PostgreSQL real (base desechable) con `app.inject()`. El reloj está fijo para
// que las reglas de "en el futuro" sean deterministas.
const NOW = new Date('2026-11-12T20:00:00.000Z');
const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '99999999-9999-4999-8999-999999999999';
const TOPIC = 'bidstream.events.lot';
const config = loadConfig({
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
});

let db: TestDatabase;
let app: FastifyInstance | undefined;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.drop();
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});

// Ids reales (UUID v7): con un generador secuencial que reinicia en cada prueba los `eventId`
// colisionarían en la clave primaria del outbox.
const realIds = new Uuid7Generator();

function make(ids: IdGenerator = realIds): FastifyInstance {
  app = buildApp({
    config,
    prisma: db.prisma,
    clock: new FixedClock(NOW),
    ids,
    tenantResolver: new HeaderTenantResolver(),
    eventsTopic: TOPIC,
  });
  return app;
}

const headers = (tenant = TENANT): Record<string, string> => ({ 'x-tenant-id': tenant });

const validAuction = {
  title: 'Arte moderno',
  opensAt: '2026-11-13T10:00:00.000Z',
  closesAt: '2026-11-13T20:00:00.000Z',
};
const validLot = {
  title: 'Óleo sobre lienzo',
  startingPrice: '100.00',
  minIncrement: '5.00',
  currency: 'USD',
  closesAt: '2026-11-13T18:00:00.000Z',
};

const outboxCount = (): Promise<number> => db.prisma.outboxMessage.count();

async function seedAuction(
  over: { status?: 'OPEN' | 'CLOSED'; tenantId?: string; closesAt?: Date } = {},
): Promise<string> {
  const id = randomUUID();
  await db.prisma.auction.create({
    data: {
      id,
      tenantId: over.tenantId ?? TENANT,
      title: 'Sembrada',
      opensAt: new Date('2026-11-12T10:00:00Z'),
      closesAt: over.closesAt ?? new Date('2026-11-13T20:00:00Z'),
      status: over.status ?? 'OPEN',
    },
  });
  return id;
}

async function eventsFor(key: string): Promise<
  {
    row: { id: string; topic: string; key: string; publishedAt: Date | null };
    event: DomainEvent;
  }[]
> {
  const rows = await db.prisma.outboxMessage.findMany({ where: { key } });
  return rows.map((row) => {
    const parsed = parseEvent(row.payload);
    if (!parsed.success) throw new Error('el outbox contiene un evento inválido');
    return { row, event: parsed.event };
  });
}

describe('POST /v1/auctions', () => {
  it('acepta el comando: 201, Location y un único AuctionOpened en el outbox', async () => {
    const res = await make().inject({
      method: 'POST',
      url: '/v1/auctions',
      headers: headers(),
      payload: validAuction,
    });
    expect(res.statusCode).toBe(201);
    const { auctionId, status } = res.json<{ auctionId: string; status: string }>();
    expect(status).toBe('OPEN');
    expect(res.headers['location']).toBe(`/v1/auctions/${auctionId}`);

    const [only, ...rest] = await eventsFor(auctionId);
    expect(rest).toHaveLength(0);
    expect(only?.event).toMatchObject({
      type: 'AuctionOpened',
      tenantId: TENANT,
      version: 1,
      payload: { auctionId, ...validAuction },
    });
    // el contrato y la clave de partición (ADR-0001 / DEC-006)
    expect(only?.row).toMatchObject({
      id: only?.event.eventId,
      topic: TOPIC,
      key: only === undefined ? '' : partitionKey(only.event),
      publishedAt: null,
    });
    expect(only?.event.occurredAt).toBe(NOW.toISOString());
  });

  it.each([
    ['título vacío', { ...validAuction, title: '' }],
    ['fecha mal formada', { ...validAuction, opensAt: 'mañana' }],
    ['fecha sin zona horaria', { ...validAuction, closesAt: '2026-11-13T20:00:00' }],
    [
      'closesAt anterior a opensAt',
      { ...validAuction, opensAt: validAuction.closesAt, closesAt: validAuction.opensAt },
    ],
    ['campo desconocido', { ...validAuction, extra: 1 }],
    ['falta un campo', { title: 'x', opensAt: validAuction.opensAt }],
  ])('rechaza con 400 y no deja nada en el outbox: %s', async (_name, payload) => {
    const before = await outboxCount();
    const res = await make().inject({
      method: 'POST',
      url: '/v1/auctions',
      headers: headers(),
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(await outboxCount()).toBe(before);
  });

  it('una subasta que cierra en el pasado → 422 y nada en el outbox', async () => {
    const before = await outboxCount();
    const res = await make().inject({
      method: 'POST',
      url: '/v1/auctions',
      headers: headers(),
      payload: {
        ...validAuction,
        opensAt: '2026-11-10T10:00:00.000Z',
        closesAt: '2026-11-11T10:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ type: 'urn:bidstream:problem:business-rule' });
    expect(await outboxCount()).toBe(before);
  });

  it('sin tenant → 401; con tenant que no es UUID → 400; nada en el outbox', async () => {
    const before = await outboxCount();
    const missing = await make().inject({
      method: 'POST',
      url: '/v1/auctions',
      payload: validAuction,
    });
    expect(missing.statusCode).toBe(401);
    const bad = await make().inject({
      method: 'POST',
      url: '/v1/auctions',
      headers: headers('no-es-uuid'),
      payload: validAuction,
    });
    expect(bad.statusCode).toBe(400);
    expect(await outboxCount()).toBe(before);
  });

  it('si el outbox falla, responde 500 genérico y no queda nada (transacción revertida)', async () => {
    // El segundo id que pide el caso de uso es el del evento: se ocupa de antemano en el outbox
    // para forzar el fallo al encolar (el primero es el de la subasta).
    const eventId = realIds.newId();
    await db.prisma.outboxMessage.create({
      data: { id: eventId, topic: 'otro', key: 'ocupado', payload: {} },
    });
    let calls = 0;
    const ids: IdGenerator = { newId: () => (++calls === 2 ? eventId : realIds.newId()) };
    const before = await outboxCount();

    const res = await make(ids).inject({
      method: 'POST',
      url: '/v1/auctions',
      headers: headers(),
      payload: validAuction,
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ title: 'Error interno' });
    expect(res.body).not.toMatch(/unique|constraint|prisma/i);
    expect(await outboxCount()).toBe(before);
  });
});

describe('POST /v1/auctions/:id/lots', () => {
  const post = (id: string, payload: unknown, tenant?: string): Promise<LightMyRequestResponse> =>
    make().inject({
      method: 'POST',
      url: `/v1/auctions/${id}/lots`,
      headers: headers(tenant),
      payload: payload as object,
    });

  it('con la subasta en la proyección: 201, Location y un único LotPublished con clave lotId', async () => {
    const auctionId = await seedAuction();
    const res = await post(auctionId, validLot);
    expect(res.statusCode).toBe(201);
    const body = res.json<{ lotId: string; auctionId: string; status: string }>();
    expect(body).toMatchObject({ auctionId, status: 'OPEN' });
    expect(res.headers['location']).toBe(`/v1/auctions/${auctionId}/lots/${body.lotId}`);

    const [only, ...rest] = await eventsFor(body.lotId);
    expect(rest).toHaveLength(0);
    expect(only?.event).toMatchObject({
      type: 'LotPublished',
      tenantId: TENANT,
      payload: { lotId: body.lotId, auctionId, ...validLot },
    });
    expect(only?.row.key).toBe(body.lotId);
    expect(only?.row.topic).toBe(TOPIC);
  });

  it('el cierre del lote puede ser posterior al de la subasta (anti-sniping)', async () => {
    const auctionId = await seedAuction({ closesAt: new Date('2026-11-12T21:00:00Z') });
    const res = await post(auctionId, { ...validLot, closesAt: '2026-11-20T00:00:00.000Z' });
    expect(res.statusCode).toBe(201);
  });

  it('subasta inexistente → 404 con Retry-After y nada en el outbox', async () => {
    const before = await outboxCount();
    const res = await post(randomUUID(), validLot);
    expect(res.statusCode).toBe(404);
    expect(res.headers['retry-after']).toBe('1');
    expect(await outboxCount()).toBe(before);
  });

  it('subasta de otro tenant → 404 (aislamiento) y nada en el outbox', async () => {
    const auctionId = await seedAuction({ tenantId: OTHER_TENANT });
    const before = await outboxCount();
    const res = await post(auctionId, validLot);
    expect(res.statusCode).toBe(404);
    expect(await outboxCount()).toBe(before);
  });

  it('subasta cerrada → 409 y nada en el outbox', async () => {
    const auctionId = await seedAuction({ status: 'CLOSED' });
    const before = await outboxCount();
    const res = await post(auctionId, validLot);
    expect(res.statusCode).toBe(409);
    expect(await outboxCount()).toBe(before);
  });

  it.each([
    ['startingPrice cero', { ...validLot, startingPrice: '0.00' }, 422],
    ['minIncrement cero', { ...validLot, minIncrement: '0' }, 422],
    ['cierre en el pasado', { ...validLot, closesAt: '2026-11-11T00:00:00.000Z' }, 422],
    ['monto negativo', { ...validLot, startingPrice: '-1' }, 400],
    ['monto con 3 decimales', { ...validLot, minIncrement: '1.005' }, 400],
    ['moneda en minúsculas', { ...validLot, currency: 'usd' }, 400],
    ['campo desconocido', { ...validLot, extra: true }, 400],
  ])(
    'rechaza (%s) con el código esperado y sin tocar el outbox',
    async (_name, payload, status) => {
      const auctionId = await seedAuction();
      const before = await outboxCount();
      const res = await post(auctionId, payload);
      expect(res.statusCode).toBe(status);
      expect(await outboxCount()).toBe(before);
    },
  );

  it('el id de la subasta debe ser un UUID', async () => {
    const res = await post('no-es-uuid', validLot);
    expect(res.statusCode).toBe(400);
  });
});

describe('OpenAPI', () => {
  it('documenta las dos rutas y sus errores', async () => {
    const res = await make().inject({ method: 'GET', url: '/v1/docs/json' });
    const doc = res.json<{
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    }>();
    expect(Object.keys(doc.paths['/v1/auctions']?.['post']?.responses ?? {})).toEqual(
      expect.arrayContaining(['201', '400', '401', '422']),
    );
    expect(Object.keys(doc.paths['/v1/auctions/{id}/lots']?.['post']?.responses ?? {})).toEqual(
      expect.arrayContaining(['201', '400', '404', '409', '422']),
    );
  });
});
