import { randomUUID } from 'node:crypto';
import { createEventConsumer, type EventConsumer, type ProcessOutcome } from '@bidstream/consumer';
import { buildEvent, type DomainEvent } from '@bidstream/domain';
import { createProducer, type KafkaProducer } from '@bidstream/kafka';
import {
  InMemoryNotificationBus,
  publishNotification,
  startNotificationListener,
  toLotNotification,
  type LotNotification,
  type RunningNotificationListener,
} from '@bidstream/notifier';
import {
  createTestDatabase,
  createTestTopic,
  generateHistory,
  testKafkaConfig,
  waitFor,
  type TestDatabase,
  type TestTopic,
} from '@bidstream/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNotifier } from './notifier.js';

// Kafka → notifier → NOTIFY → oyente → bus, todo real.
const kafka = testKafkaConfig();
const OTHER_TENANT = '99999999-9999-4999-8999-999999999999';
const GROUP = `notifier-test-${randomUUID()}`; // el grupo `notifier` es global en el clúster
const history = generateHistory({ seed: 7, auctions: 1, lotsPerAuction: 2, bidsPerLot: 6 });
const tenant = history[0]?.tenantId ?? '';

let db: TestDatabase;
let events: TestTopic;
let dlq: TestTopic;
let producer: KafkaProducer;
let notifier: EventConsumer;
let listener: RunningNotificationListener;
const bus = new InMemoryNotificationBus();
const outcomes: ProcessOutcome[] = [];
const received = new Map<string, LotNotification[]>();
const foreign: LotNotification[] = [];

const lotIds = [
  ...new Set(history.flatMap((e) => ('lotId' in e.payload ? [e.payload.lotId] : []))),
];

/** Lo que debe notificarse para un lote: las notificaciones de sus eventos, en orden. */
const expectedFor = (lotId: string): LotNotification[] =>
  history
    .filter((e) => 'lotId' in e.payload && e.payload.lotId === lotId)
    .flatMap((e) => toLotNotification(e) ?? []);

beforeAll(async () => {
  db = await createTestDatabase();
  [events, dlq] = await Promise.all([createTestTopic({ partitions: 3 }), createTestTopic()]);
  producer = await createProducer(kafka, { eventsTopic: events.name });
  for (const lot of lotIds) {
    received.set(lot, []);
    bus.subscribe(tenant, lot, (n) => received.get(lot)?.push(n));
    bus.subscribe(OTHER_TENANT, lot, (n) => foreign.push(n)); // otro tenant: no debe recibir nada
  }
  listener = startNotificationListener({ connectionString: db.url, bus });
  await listener.ready;
  notifier = await createNotifier({
    groupId: GROUP,
    kafka,
    prisma: db.prisma,
    topics: [events.name],
    dlqTopic: dlq.name,
    retry: { baseDelayMs: 1, capMs: 2 },
    onOutcome: (o) => outcomes.push(o),
  });
  void notifier.run();
});
afterAll(async () => {
  await notifier.disconnect();
  await listener.stop();
  await producer.disconnect();
  await Promise.all([events.drop(), dlq.drop()]);
  await db.drop();
});

describe('notifier (Kafka + PostgreSQL reales)', () => {
  it('cada lote recibe sus notificaciones, en orden, y las no públicas no generan ninguna', async () => {
    for (const e of history) await producer.publishEvent(e);
    await waitFor(() => outcomes.length === history.length, {
      description: 'todos los eventos procesados',
    });
    const expectedTotal = lotIds.reduce((n, lot) => n + expectedFor(lot).length, 0);
    await waitFor(
      () => [...received.values()].reduce((n, list) => n + list.length, 0) === expectedTotal,
      { description: 'todas las notificaciones' },
    );

    for (const lot of lotIds) expect(received.get(lot)).toEqual(expectedFor(lot));
    // hay eventos sin notificación (AuctionOpened, AuctionClosed, BidRejected) y se procesaron igual
    expect(expectedTotal).toBeLessThan(history.length);
    expect(outcomes.every((o) => o.kind === 'processed')).toBe(true);
  });

  it('nunca revela identidades, y otro tenant no recibe nada', () => {
    const text = JSON.stringify([...received.values()]);
    expect(text).not.toMatch(/bidderId|winnerId/);
    expect(foreign).toHaveLength(0);
  });

  it('los eventos sin notificación quedan registrados como procesados por el grupo', async () => {
    const { rows } = await db.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM processed_event WHERE consumer = $1',
      [GROUP],
    );
    expect(rows[0]?.n).toBe(history.length);
  });

  it('un evento entregado dos veces notifica una sola vez', async () => {
    const lot = lotIds[0] ?? '';
    const before = received.get(lot)?.length ?? 0;
    const beforeOutcomes = outcomes.length;
    const replay = history.find(
      (e) => e.type === 'BidPlaced' && e.payload.lotId === lot,
    ) as DomainEvent;
    await producer.publishEvent(replay);
    await waitFor(() => outcomes.length > beforeOutcomes, { description: 'la reentrega' });
    await new Promise((r) => setTimeout(r, 300));
    expect(outcomes.at(-1)).toEqual({ kind: 'duplicate' });
    expect(received.get(lot)?.length).toBe(before);
  });
});

describe('atomicidad con el consumidor base', () => {
  it('si el handler falla tras notificar, esa notificación no sale; el reintento notifica una sola vez', async () => {
    const [topic, dlqTopic] = await Promise.all([createTestTopic(), createTestTopic()]);
    const lot = randomUUID();
    const got: LotNotification[] = [];
    const unsubscribe = bus.subscribe(tenant, lot, (n) => got.push(n));
    const attempts: ProcessOutcome[] = [];
    let calls = 0;
    const consumer = await createEventConsumer({
      kafka,
      prisma: db.prisma,
      consumerName: `notifier-atomicidad-${randomUUID()}`,
      topics: [topic.name],
      dlqTopic: dlqTopic.name,
      retry: { baseDelayMs: 1, capMs: 2 },
      handler: async (event, { tx }) => {
        calls += 1;
        const n = toLotNotification(event);
        if (n !== null) await publishNotification(tx, n);
        if (calls === 1) throw new Error('falla después de notificar');
      },
      onOutcome: (o) => attempts.push(o),
    });
    const p = await createProducer(kafka, { eventsTopic: topic.name });
    try {
      void consumer.run();
      await p.publishEvent(
        buildEvent('LotExtended', tenant, {
          lotId: lot,
          newClosesAt: '2030-01-01T00:05:00.000Z',
          reason: 'anti-sniping',
        }),
      );
      await waitFor(() => attempts.length === 1, { description: 'evento procesado' });
      await waitFor(() => got.length >= 1, { description: 'la notificación' });
      await new Promise((r) => setTimeout(r, 400));
      expect(attempts[0]).toEqual({ kind: 'processed', attempts: 2 });
      expect(calls).toBe(2);
      expect(got).toHaveLength(1);
    } finally {
      unsubscribe();
      await consumer.disconnect();
      await p.disconnect();
      await Promise.all([topic.drop(), dlqTopic.drop()]);
    }
  });
});
