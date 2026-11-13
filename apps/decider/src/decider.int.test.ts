import { randomUUID } from 'node:crypto';
import { buildApp, loadConfig, placeBid, Uuid7Generator } from '@bidstream/api';
import { createProjector } from '@bidstream/projector';
import { createEventConsumer, reprocessDlq, type EventConsumer } from '@bidstream/consumer';
import { applyEventToDecision, PrismaOutbox } from '@bidstream/db';
import {
  buildCommand,
  buildEvent,
  decideBid,
  FixedClock,
  foldLot,
  parseEvent,
  type DomainEvent,
} from '@bidstream/domain';
import { createProducer, type KafkaProducer } from '@bidstream/kafka';
import { OutboxRelay } from '@bidstream/relay';
import {
  collectMessages,
  createTestDatabase,
  createTestTopic,
  testKafkaConfig,
  waitFor,
  warmUpGroupCoordinator,
  type TestDatabase,
  type TestTopic,
} from '@bidstream/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDecider, type Decider } from './decider.js';

// C3: la puja se acepta por la API, se decide en orden por el decisor y llega por evento. Todo real:
// PostgreSQL, Kafka, relay, projector. Los grupos son únicos por ejecución (son globales en el clúster).
const kafka = testKafkaConfig();
const TENANT = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-14T12:00:00.000Z');
const ANTI_SNIPING = { windowMs: 60_000, extensionMs: 60_000 };

let db: TestDatabase;
let events: TestTopic;
let commands: TestTopic;
let dlq: TestTopic;
let producer: KafkaProducer;
let app: FastifyInstance;
let relay: OutboxRelay;
let decider: Decider;
let projector: EventConsumer;
let pumping = true;
let pump: Promise<void>;
const bidderCount = 8;
const bidders = Array.from({ length: bidderCount }, () => randomUUID());

beforeAll(async () => {
  await warmUpGroupCoordinator();
  db = await createTestDatabase();
  [events, commands, dlq] = await Promise.all([
    createTestTopic({ partitions: 3 }),
    createTestTopic({ partitions: 3 }),
    createTestTopic(),
  ]);
  producer = await createProducer(kafka);
  app = buildApp({
    config: loadConfig({
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
    }),
    prisma: db.prisma,
    clock: new FixedClock(NOW),
    ids: new Uuid7Generator(),
    tenantResolver: { resolve: () => TENANT },
    eventsTopic: events.name,
    commandsTopic: commands.name,
  });
  relay = new OutboxRelay({
    prisma: db.prisma,
    publish: (r) => producer.publish(r.topic, { key: r.key, value: r.value, headers: r.headers }),
  });
  // El relay publica en orden y de uno en uno: nunca dos rondas a la vez.
  pump = (async () => {
    while (pumping) {
      await relay.runOnce();
      await new Promise((r) => setTimeout(r, 40));
    }
  })();
  decider = await createDecider({
    kafka,
    prisma: db.prisma,
    antiSniping: ANTI_SNIPING,
    commandsTopic: commands.name,
    eventsTopic: events.name,
    dlqTopic: dlq.name,
    commandsGroup: `decider-${randomUUID()}`,
    stateGroup: `decider-state-${randomUUID()}`,
    retry: { baseDelayMs: 1, capMs: 5, maxRetries: 3 },
  });
  void decider.run();
  projector = await createProjector({
    kafka,
    prisma: db.prisma,
    topics: [events.name],
    dlqTopic: dlq.name,
    groupId: `projector-${randomUUID()}`,
  });
  void projector.run();
}, 180_000);

afterAll(async () => {
  pumping = false;
  await pump;
  await decider.disconnect();
  await projector.disconnect();
  await app.close();
  await producer.disconnect();
  await Promise.all([events.drop(), commands.drop(), dlq.drop()]);
  await db.drop();
});

/** Publica `LotPublished` y espera a que el decisor y la proyección conozcan el lote. */
async function newLot(options: { closesAt?: string; startingPrice?: string } = {}) {
  const lotId = randomUUID();
  const event = buildEvent('LotPublished', TENANT, {
    lotId,
    auctionId: randomUUID(),
    title: 'Lote de prueba',
    startingPrice: options.startingPrice ?? '100.00',
    minIncrement: '5.00',
    currency: 'USD',
    closesAt: options.closesAt ?? '2026-11-14T13:00:00.000Z',
  });
  await new PrismaOutbox(db.prisma).enqueue([event], events.name);
  await waitFor(
    async () =>
      (await db.prisma.lotDecision.count({ where: { lotId } })) === 1 &&
      (await db.prisma.lot.count({ where: { id: lotId } })) === 1,
    { description: 'el lote es conocido por el decisor y la proyección' },
  );
  return { lotId, published: event };
}

const bid = (lotId: string, bidderId: string, amount: string) =>
  app.inject({
    method: 'POST',
    url: `/v1/lots/${lotId}/bids`,
    headers: { 'x-bidder-id': bidderId, 'idempotency-key': `clave-${randomUUID()}` },
    payload: { amount },
  });

/** Eventos de decisión del lote, en el orden en que el decisor los escribió en el outbox. */
async function decisions(lotId: string): Promise<DomainEvent[]> {
  const rows = await db.prisma.outboxMessage.findMany({
    where: { topic: events.name, key: lotId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.flatMap((row) => {
    const parsed = parseEvent(row.payload);
    return parsed.success && parsed.event.type !== 'LotPublished' ? [parsed.event] : [];
  });
}

const waitForDecisions = (lotId: string, count: number) =>
  waitFor(async () => (await decisions(lotId)).length >= count, {
    description: `${String(count)} decisiones del lote`,
    timeoutMs: 60_000,
  });

describe('API: aceptar la puja', () => {
  it('202 con commandId y el comando queda en el outbox con clave lotId', async () => {
    const { lotId } = await newLot();
    const res = await bid(lotId, bidders[0] ?? '', '100.00');
    expect(res.statusCode).toBe(202);
    const body = res.json<{ commandId: string; status: string }>();
    expect(body.status).toBe('ACCEPTED');
    const row = await db.prisma.outboxMessage.findUnique({ where: { id: body.commandId } });
    expect(row).toMatchObject({ topic: commands.name, key: lotId });
    expect(row?.payload).toMatchObject({
      type: 'PlaceBid',
      payload: { lotId, bidderId: bidders[0], amount: '100.00' },
    });
  });

  it('lote desconocido → 404 con Retry-After y no deja comando', async () => {
    const before = await db.prisma.outboxMessage.count({ where: { topic: commands.name } });
    const res = await bid(randomUUID(), bidders[0] ?? '', '100.00');
    expect(res.statusCode).toBe(404);
    expect(res.headers['retry-after']).toBe('1');
    expect(await db.prisma.outboxMessage.count({ where: { topic: commands.name } })).toBe(before);
  });

  it.each([
    ['monto con tres decimales', '100.005'],
    ['monto negativo', '-1.00'],
    ['monto vacío', ''],
  ])('%s → 400', async (_name, amount) => {
    const { lotId } = await newLot();
    expect((await bid(lotId, bidders[0] ?? '', amount)).statusCode).toBe(400);
  });

  it('sin postor o con postor inválido → 401/400 y nada en el outbox', async () => {
    const { lotId } = await newLot();
    const before = await db.prisma.outboxMessage.count({ where: { topic: commands.name } });
    const none = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lotId}/bids`,
      headers: { 'idempotency-key': `clave-${randomUUID()}` },
      payload: { amount: '100.00' },
    });
    const bad = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lotId}/bids`,
      headers: { 'x-bidder-id': 'no-uuid', 'idempotency-key': `clave-${randomUUID()}` },
      payload: { amount: '100.00' },
    });
    expect([none.statusCode, bad.statusCode]).toEqual([401, 400]);
    expect(await db.prisma.outboxMessage.count({ where: { topic: commands.name } })).toBe(before);
  });

  it('si falla el outbox se revierte todo: no queda comando', async () => {
    const { lotId } = await newLot();
    const before = await db.prisma.outboxMessage.count({ where: { topic: commands.name } });
    const failing = {
      $transaction: <T>(work: (tx: unknown) => Promise<T>) =>
        db.prisma.$transaction(async (tx) =>
          work(
            new Proxy(tx, {
              get: (target, prop, receiver) =>
                prop === 'outboxMessage'
                  ? { createMany: () => Promise.reject(new Error('outbox caído')) }
                  : (Reflect.get(target, prop, receiver) as unknown),
            }),
          ),
        ),
    };
    await expect(
      placeBid(
        {
          prisma: failing as never,
          clock: new FixedClock(NOW),
          ids: new Uuid7Generator(),
          eventsTopic: events.name,
          commandsTopic: commands.name,
        },
        TENANT,
        bidders[0] ?? '',
        lotId,
        { amount: '100.00', idempotencyKey: `clave-${randomUUID()}` },
      ),
    ).rejects.toThrow('outbox caído');
    expect(await db.prisma.outboxMessage.count({ where: { topic: commands.name } })).toBe(before);
  });
});

describe('decisor: reglas de la puja', () => {
  it('válida → BidPlaced; baja → BidRejected(BID_TOO_LOW); sube el mínimo con el incremento', async () => {
    const { lotId } = await newLot();
    await bid(lotId, bidders[0] ?? '', '100.00'); // = precio inicial: válida
    await bid(lotId, bidders[1] ?? '', '102.00'); // < 100 + 5: baja
    await bid(lotId, bidders[2] ?? '', '105.00'); // = 100 + 5: válida
    await waitForDecisions(lotId, 3);
    const types = (await decisions(lotId)).map((e) =>
      e.type === 'BidRejected' ? `${e.type}:${e.payload.reason}` : e.type,
    );
    expect(types).toEqual(['BidPlaced', 'BidRejected:BID_TOO_LOW', 'BidPlaced']);
  });

  it('dos pujas del mismo monto seguidas: gana la primera y la segunda se rechaza (sin esperar al projector)', async () => {
    const { lotId } = await newLot();
    await bid(lotId, bidders[0] ?? '', '120.00');
    await bid(lotId, bidders[1] ?? '', '120.00');
    await waitForDecisions(lotId, 2);
    const [first, second] = await decisions(lotId);
    expect(first).toMatchObject({ type: 'BidPlaced', payload: { bidderId: bidders[0] } });
    expect(second).toMatchObject({
      type: 'BidRejected',
      payload: { bidderId: bidders[1], reason: 'BID_TOO_LOW' },
    });
  });

  it('una puja en la ventana del cierre produce BidPlaced + LotExtended y extiende el estado', async () => {
    const { lotId } = await newLot({ closesAt: '2026-11-14T12:00:30.000Z' }); // 30 s < 60 s de ventana
    await bid(lotId, bidders[0] ?? '', '100.00');
    await waitForDecisions(lotId, 2);
    expect((await decisions(lotId)).map((e) => e.type)).toEqual(['BidPlaced', 'LotExtended']);
    const state = await db.prisma.lotDecision.findUniqueOrThrow({ where: { lotId } });
    expect(state.closesAt.toISOString()).toBe('2026-11-14T12:01:30.000Z');
  });

  it('una puja posterior al cierre se rechaza con LOT_CLOSED', async () => {
    const { lotId } = await newLot({ closesAt: '2026-11-14T11:00:00.000Z' }); // ya pasó para NOW
    await bid(lotId, bidders[0] ?? '', '100.00');
    await waitForDecisions(lotId, 1);
    expect((await decisions(lotId))[0]).toMatchObject({
      type: 'BidRejected',
      payload: { reason: 'LOT_CLOSED' },
    });
  });

  it('un comando duplicado (reentrega) no duplica los eventos', async () => {
    const { lotId } = await newLot();
    const command = buildCommand('PlaceBid', TENANT, {
      lotId,
      bidderId: bidders[0] ?? '',
      amount: '100.00',
    });
    const value = JSON.stringify(command);
    await producer.publish(commands.name, { key: lotId, value, headers: {} });
    await producer.publish(commands.name, { key: lotId, value, headers: {} });
    await waitForDecisions(lotId, 1);
    await new Promise((r) => setTimeout(r, 1_500)); // margen para que un duplicado se notara
    expect(await decisions(lotId)).toHaveLength(1);
  });
});

describe('concurrencia', () => {
  it('50 pujas simultáneas: el resultado coincide con el dominio y hay un único ganador', async () => {
    const { lotId, published } = await newLot();
    const amounts = Array.from({ length: 50 }, (_, i) => (100 + 5 * (i % 20)).toFixed(2));
    const responses = await Promise.all(
      amounts.map((amount, i) => bid(lotId, bidders[i % bidderCount] ?? '', amount)),
    );
    expect(responses.every((r) => r.statusCode === 202)).toBe(true);
    await waitForDecisions(lotId, 50);

    const history = await decisions(lotId);
    const placed = history.filter((e) => e.type === 'BidPlaced');
    const rejected = history.filter((e) => e.type === 'BidRejected');
    expect(placed.length + rejected.length).toBe(50);
    expect(rejected.every((e) => e.payload.reason === 'BID_TOO_LOW')).toBe(true);

    // los importes aceptados crecen al menos en el incremento, en el orden de decisión
    const accepted = placed.map((e) => Number(e.payload.amount));
    accepted.slice(1).forEach((amount, i) => {
      expect(amount).toBeGreaterThanOrEqual((accepted[i] ?? 0) + 5);
    });

    // el estado en vivo == el que reconstruye el dominio desde el historial (reproceso del estado)
    const folded = foldLot([published, ...history]);
    const live = await db.prisma.lotDecision.findUniqueOrThrow({ where: { lotId } });
    expect(Number(live.currentPrice)).toBe(Math.max(...accepted));
    expect(live.currentBidder).toBe(folded?.currentBidderId);
    expect(live.closesAt.toISOString()).toBe(folded?.closesAt.toISOString());

    // cada decisión es la que habría tomado el dominio puro con el estado de ese instante
    let state = foldLot([published]);
    for (const event of history) {
      if (event.type === 'BidPlaced' || event.type === 'BidRejected') {
        const expected = decideBid(
          state as NonNullable<typeof state>,
          {
            bidderId: event.payload.bidderId,
            amount: BigInt(Math.round(Number(event.payload.amount) * 100)),
            placedAt: NOW,
          },
          ANTI_SNIPING,
        );
        expect(expected[0]?.type).toBe(event.type);
      }
      state = foldLot([published, ...history.slice(0, history.indexOf(event) + 1)]);
    }
  }, 120_000);
});

describe('lote aún desconocido para el decisor', () => {
  it('reintenta, va al DLQ y, tras conocer el lote, el reproceso (D7) decide', async () => {
    const lotId = randomUUID();
    const command = buildCommand('PlaceBid', TENANT, {
      lotId,
      bidderId: bidders[0] ?? '',
      amount: '100.00',
    });
    await new PrismaOutbox(db.prisma).enqueueCommand(command, commands.name);

    const [dead] = await collectMessages({ topic: dlq.name, count: 1, timeoutMs: 60_000 });
    expect(JSON.parse(dead?.value ?? '{}')).toMatchObject({
      reason: 'retries-exhausted',
      error: { name: 'LotStateNotReady' },
    });

    // ahora el decisor conoce el lote
    const published = buildEvent('LotPublished', TENANT, {
      lotId,
      auctionId: randomUUID(),
      title: 'Tardío',
      startingPrice: '100.00',
      minIncrement: '5.00',
      currency: 'USD',
      closesAt: '2026-11-14T13:00:00.000Z',
    });
    await new PrismaOutbox(db.prisma).enqueue([published], events.name);
    await waitFor(async () => (await db.prisma.lotDecision.count({ where: { lotId } })) === 1, {
      description: 'el decisor conoce el lote',
    });

    const summary = await reprocessDlq({
      kafka,
      dlqTopic: dlq.name,
      reprocessorGroup: `dlq-reprocessor-${randomUUID()}`,
      eventIds: [command.commandId],
    });
    expect(summary.republished).toBe(1);
    await waitForDecisions(lotId, 1);
    expect((await decisions(lotId))[0]).toMatchObject({ type: 'BidPlaced' });
  }, 120_000);
});

describe('flujo completo', () => {
  it('REST → comando → decisor → evento → proyección: el precio vigente llega a la proyección', async () => {
    const { lotId } = await newLot();
    await bid(lotId, bidders[0] ?? '', '100.00');
    await bid(lotId, bidders[1] ?? '', '110.00');
    await waitFor(
      async () => {
        const lot = await db.prisma.lot.findUnique({ where: { id: lotId } });
        return lot?.currentPrice?.toFixed(2) === '110.00';
      },
      { description: 'la proyección refleja la puja ganadora', timeoutMs: 60_000 },
    );
    const lot = await db.prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
    expect(lot.currentBidder).toBe(bidders[1]);
    expect(await db.prisma.bid.count({ where: { lotId } })).toBe(2);
  });
});

describe('reproceso del estado', () => {
  it('lot_decision reconstruido desde el log == el estado en vivo', async () => {
    const snapshot = async () =>
      JSON.stringify(await db.prisma.lotDecision.findMany({ orderBy: { lotId: 'asc' } }));
    const live = await snapshot();
    expect(JSON.parse(live)).not.toHaveLength(0);

    // se borra el estado y un consumidor nuevo (grupo nuevo, lee desde earliest) lo rehace
    await db.prisma.lotDecision.deleteMany();
    const rebuilder = await createEventConsumer({
      kafka,
      prisma: db.prisma,
      consumerName: `decider-rebuild-${randomUUID()}`,
      topics: [events.name],
      dlqTopic: dlq.name,
      handler: (event, { tx }) => applyEventToDecision(tx, event),
    });
    void rebuilder.run();
    try {
      await waitFor(async () => (await snapshot()) === live, {
        description: 'el estado reconstruido coincide con el original',
        timeoutMs: 60_000,
      });
    } finally {
      await rebuilder.disconnect();
    }
  }, 120_000);
});
