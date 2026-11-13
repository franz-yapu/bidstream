import { buildApp, HeaderTenantResolver, Uuid7Generator } from '@bidstream/api';
import { loadConfig } from '@bidstream/api';
import { PrismaAuctionRepository, PrismaLotRepository, PrismaOutbox } from '@bidstream/db';
import {
  buildEvent,
  FixedClock,
  foldLot,
  evolveAuction,
  parseEvent,
  type AuctionState,
  type DomainEvent,
} from '@bidstream/domain';
import { createProducer, type KafkaProducer } from '@bidstream/kafka';
import { OutboxRelay } from '@bidstream/relay';
import {
  createTestDatabase,
  createTestTopic,
  testKafkaConfig,
  waitFor,
  type TestDatabase,
  type TestTopic,
} from '@bidstream/testing';
import type { EventConsumer, ProcessOutcome } from '@bidstream/consumer';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjector } from './projector.js';

// El primer flujo completo con todo real: API → outbox → relay → Kafka → projector → PostgreSQL.
const kafka = testKafkaConfig();
const TENANT = '11111111-1111-4111-8111-111111111111';
const ANA = '44444444-4444-4444-8444-444444444444';
const BEN = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-11-12T20:00:00.000Z');

let db: TestDatabase;
let events: TestTopic;
let dlq: TestTopic;
let producer: KafkaProducer;
let projector: EventConsumer;
let app: FastifyInstance;
let relay: OutboxRelay;
let lots: PrismaLotRepository;
let auctions: PrismaAuctionRepository;
const outcomes: ProcessOutcome[] = [];

beforeAll(async () => {
  db = await createTestDatabase();
  [events, dlq] = await Promise.all([createTestTopic({ partitions: 3 }), createTestTopic()]);
  producer = await createProducer(kafka);
  lots = new PrismaLotRepository(db.prisma);
  auctions = new PrismaAuctionRepository(db.prisma);

  app = buildApp({
    config: loadConfig({
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
    }),
    prisma: db.prisma,
    clock: new FixedClock(NOW),
    ids: new Uuid7Generator(),
    tenantResolver: new HeaderTenantResolver(),
    eventsTopic: events.name,
    commandsTopic: 'bidstream.commands.bid',
  });
  relay = new OutboxRelay({
    prisma: db.prisma,
    publish: (r) => producer.publish(r.topic, { key: r.key, value: r.value, headers: r.headers }),
  });
  projector = await createProjector({
    kafka,
    prisma: db.prisma,
    topics: [events.name],
    dlqTopic: dlq.name,
    retry: { baseDelayMs: 1, capMs: 2 },
    onOutcome: (o) => outcomes.push(o),
  });
  void projector.run();
});

afterAll(async () => {
  await projector.disconnect();
  await app.close();
  await producer.disconnect();
  await Promise.all([events.drop(), dlq.drop()]);
  await db.drop();
});

/** Publica lo pendiente y espera a que el projector procese `expected` eventos más. */
async function relayAndWait(expected: number): Promise<void> {
  const target = outcomes.length + expected;
  const result = await relay.runOnce();
  expect(result).toMatchObject({ published: expected });
  await waitFor(() => outcomes.length >= target, {
    description: `${String(expected)} eventos proyectados`,
  });
}

async function outboxHistory(): Promise<DomainEvent[]> {
  const rows = await db.prisma.outboxMessage.findMany({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map((row) => {
    const parsed = parseEvent(row.payload);
    if (!parsed.success) throw new Error('el outbox contiene un evento inválido');
    return parsed.event;
  });
}

describe('flujo completo', () => {
  it('abrir subasta, publicar lote, pujar y cerrar: la proyección coincide con el dominio', async () => {
    const headers = { 'x-tenant-id': TENANT };

    // 1. API: abrir subasta → outbox → relay → Kafka → projector → proyección
    const auctionRes = await app.inject({
      method: 'POST',
      url: '/v1/auctions',
      headers,
      payload: {
        title: 'Arte moderno',
        opensAt: '2026-11-13T10:00:00.000Z',
        closesAt: '2026-11-13T20:00:00.000Z',
      },
    });
    expect(auctionRes.statusCode).toBe(201);
    const { auctionId } = auctionRes.json<{ auctionId: string }>();
    await relayAndWait(1);
    expect(await auctions.findById(TENANT, auctionId)).toMatchObject({ status: 'open' });

    // 2. API: ahora la subasta ya está en la proyección, así que el lote se acepta
    const lotRes = await app.inject({
      method: 'POST',
      url: `/v1/auctions/${auctionId}/lots`,
      headers,
      payload: {
        title: 'Óleo sobre lienzo',
        startingPrice: '100.00',
        minIncrement: '5.00',
        currency: 'USD',
        closesAt: '2026-11-13T18:00:00.000Z',
      },
    });
    expect(lotRes.statusCode).toBe(201);
    const { lotId } = lotRes.json<{ lotId: string }>();
    await relayAndWait(1);
    expect((await auctions.findById(TENANT, auctionId))?.openLotIds).toEqual(new Set([lotId]));

    // 3. Pujas y cierre (aún no hay API de pujas: C3): se escriben en el outbox como lo haría ella
    const placed = (bidderId: string, amount: string): DomainEvent =>
      buildEvent('BidPlaced', TENANT, {
        lotId,
        bidderId,
        amount,
        placedAt: '2026-11-13T17:00:00.000Z',
      });
    await new PrismaOutbox(db.prisma).enqueue(
      [
        placed(ANA, '100.00'),
        placed(BEN, '120.00'),
        buildEvent('LotClosed', TENANT, { lotId, winnerId: BEN, finalAmount: '120.00' }),
      ],
      events.name,
    );
    await relayAndWait(3);

    // 4. El estado proyectado es el que reconstruye el dominio del mismo historial
    const history = await outboxHistory();
    expect(history.map((e) => e.type)).toEqual([
      'AuctionOpened',
      'LotPublished',
      'BidPlaced',
      'BidPlaced',
      'LotClosed',
    ]);
    expect(await lots.findById(TENANT, lotId)).toEqual(foldLot(history));
    expect(await lots.findById(TENANT, lotId)).toMatchObject({
      status: 'closed',
      winnerId: BEN,
      finalAmount: 12000n,
    });
    expect(await auctions.findById(TENANT, auctionId)).toEqual(
      history.reduce<AuctionState | undefined>(evolveAuction, undefined),
    );
    expect(outcomes.every((o) => o.kind === 'processed')).toBe(true);
  });

  it('un evento entregado dos veces se aplica una sola vez', async () => {
    const auctionId = crypto.randomUUID();
    const event = buildEvent('AuctionOpened', TENANT, {
      auctionId,
      title: 'Duplicada',
      opensAt: '2026-11-13T10:00:00.000Z',
      closesAt: '2026-11-13T20:00:00.000Z',
    });
    await new PrismaOutbox(db.prisma).enqueue([event], events.name);
    await relayAndWait(1);

    // el mismo mensaje otra vez, como si Kafka lo reentregara
    const before = outcomes.length;
    await producer.publish(events.name, {
      key: auctionId,
      value: JSON.stringify(event),
      headers: { eventId: event.eventId },
    });
    await waitFor(() => outcomes.length > before, { description: 'la reentrega' });

    expect(outcomes.at(-1)).toEqual({ kind: 'duplicate' });
    expect(await db.prisma.auction.count({ where: { id: auctionId } })).toBe(1);
  });
});
