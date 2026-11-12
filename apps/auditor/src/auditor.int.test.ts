import { randomUUID } from 'node:crypto';
import { recordAuditEntry } from '@bidstream/db';
import { createEventConsumer, type EventConsumer, type ProcessOutcome } from '@bidstream/consumer';
import { buildEvent, type DomainEvent } from '@bidstream/domain';
import { createProducer, type KafkaProducer } from '@bidstream/kafka';
import { createProjector } from '@bidstream/projector';
import {
  createTestDatabase,
  createTestTopic,
  testKafkaConfig,
  waitFor,
  type TestDatabase,
  type TestTopic,
} from '@bidstream/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuditor } from './auditor.js';

// El auditor contra Kafka y PostgreSQL reales, junto al projector (grupos independientes).
const kafka = testKafkaConfig();
const TENANT = '11111111-1111-4111-8111-111111111111';
const ANA = '44444444-4444-4444-8444-444444444444';
const T = '2026-11-13T20:00:00.000Z';

let db: TestDatabase;
let events: TestTopic;
let dlq: TestTopic;
let producer: KafkaProducer;
const consumers: EventConsumer[] = [];
const auditorOutcomes: ProcessOutcome[] = [];
const projectorOutcomes: ProcessOutcome[] = [];

const auctionId = randomUUID();
const lotId = randomUUID();
/** Historia válida de un lote con los siete tipos de evento. */
const history: DomainEvent[] = [
  buildEvent('AuctionOpened', TENANT, {
    auctionId,
    title: 'Arte',
    opensAt: '2026-11-12T10:00:00.000Z',
    closesAt: T,
  }),
  buildEvent('LotPublished', TENANT, {
    lotId,
    auctionId,
    title: 'Óleo',
    startingPrice: '100.00',
    minIncrement: '5.00',
    currency: 'USD',
    closesAt: T,
  }),
  buildEvent('BidPlaced', TENANT, {
    lotId,
    bidderId: ANA,
    amount: '100.00',
    placedAt: '2026-11-13T19:00:00.000Z',
  }),
  buildEvent('BidRejected', TENANT, {
    lotId,
    bidderId: ANA,
    amount: '1.00',
    reason: 'BID_TOO_LOW',
  }),
  buildEvent('LotExtended', TENANT, {
    lotId,
    newClosesAt: '2026-11-13T20:05:00.000Z',
    reason: 'anti-sniping',
  }),
  buildEvent('LotClosed', TENANT, { lotId, winnerId: ANA, finalAmount: '100.00' }),
  buildEvent('AuctionClosed', TENANT, { auctionId }),
];

beforeAll(async () => {
  db = await createTestDatabase();
  [events, dlq] = await Promise.all([createTestTopic({ partitions: 3 }), createTestTopic()]);
  producer = await createProducer(kafka, { eventsTopic: events.name });
  const common = {
    kafka,
    prisma: db.prisma,
    topics: [events.name],
    dlqTopic: dlq.name,
    retry: { baseDelayMs: 1, capMs: 2 },
  };
  const auditor = await createAuditor({ ...common, onOutcome: (o) => auditorOutcomes.push(o) });
  const projector = await createProjector({
    ...common,
    onOutcome: (o) => projectorOutcomes.push(o),
  });
  consumers.push(auditor, projector);
  void auditor.run();
  void projector.run();
});
afterAll(async () => {
  await Promise.all(consumers.map((c) => c.disconnect()));
  await producer.disconnect();
  await Promise.all([events.drop(), dlq.drop()]);
  await db.drop();
});

describe('auditor (Kafka + PostgreSQL reales)', () => {
  it('registra los 7 tipos, incluido BidRejected, con el evento intacto; el projector procesa lo suyo por separado', async () => {
    for (const e of history) await producer.publishEvent(e);
    await waitFor(() => auditorOutcomes.length === 7 && projectorOutcomes.length === 7, {
      description: 'ambos consumidores terminan',
    });

    const rows = await db.prisma.auditLog.findMany({
      orderBy: [{ occurredAt: 'asc' }, { eventId: 'asc' }],
    });
    expect(rows.map((r) => r.type)).toEqual(history.map((e) => e.type));
    for (const [i, row] of rows.entries()) {
      expect(row.payload).toEqual(JSON.parse(JSON.stringify(history[i])));
      expect(row.sourceTopic).toBe(events.name);
    }
    expect(rows.some((r) => r.type === 'BidRejected')).toBe(true);

    // grupos independientes: cada consumidor registró cada evento una vez, y el projector aplicó los suyos
    const processed = await db.pool.query<{ consumer: string; n: number }>(
      `SELECT consumer, count(*)::int AS n FROM processed_event GROUP BY consumer ORDER BY consumer`,
    );
    expect(processed.rows).toEqual([
      { consumer: 'auditor', n: 7 },
      { consumer: 'projector', n: 7 },
    ]);
    expect(await db.prisma.lot.count({ where: { id: lotId, status: 'CLOSED' } })).toBe(1);
    expect(auditorOutcomes.every((o) => o.kind === 'processed')).toBe(true);
  });

  it('el historial de un lote, leído por clave, reproduce en orden lo publicado', async () => {
    const rows = await db.prisma.auditLog.findMany({
      where: { key: lotId },
      orderBy: [{ occurredAt: 'asc' }, { eventId: 'asc' }],
    });
    expect(rows.map((r) => r.eventId)).toEqual(
      history.filter((e) => 'lotId' in e.payload).map((e) => e.eventId),
    );
  });

  it('un evento entregado dos veces deja una sola fila', async () => {
    const before = auditorOutcomes.length;
    await producer.publishEvent(history[3] as DomainEvent); // el BidRejected otra vez
    await waitFor(() => auditorOutcomes.length > before, { description: 'la reentrega' });
    expect(auditorOutcomes.at(-1)).toEqual({ kind: 'duplicate' });
    expect(
      await db.prisma.auditLog.count({ where: { eventId: (history[3] as DomainEvent).eventId } }),
    ).toBe(1);
  });
});

describe('atomicidad con el consumidor base', () => {
  it('si el handler falla tras registrar, no queda fila y el reintento escribe una sola vez', async () => {
    const [topic, dlqTopic] = await Promise.all([createTestTopic(), createTestTopic()]);
    const event = buildEvent('AuctionClosed', TENANT, { auctionId: randomUUID() });
    const outcomes: ProcessOutcome[] = [];
    let calls = 0;
    const consumer = await createEventConsumer({
      kafka,
      prisma: db.prisma,
      consumerName: 'auditor-atomicidad',
      topics: [topic.name],
      dlqTopic: dlqTopic.name,
      retry: { baseDelayMs: 1, capMs: 2 },
      handler: async (e, { tx, message }) => {
        calls += 1;
        await recordAuditEntry(tx, e, {
          topic: message.topic,
          partition: message.partition,
          offset: message.offset,
        });
        if (calls === 1) throw new Error('falla después de registrar');
      },
      onOutcome: (o) => outcomes.push(o),
    });
    const p = await createProducer(kafka, { eventsTopic: topic.name });
    try {
      void consumer.run();
      await p.publishEvent(event);
      await waitFor(() => outcomes.length === 1, { description: 'evento procesado' });
      expect(outcomes[0]).toEqual({ kind: 'processed', attempts: 2 });
      expect(calls).toBe(2);
      expect(await db.prisma.auditLog.count({ where: { eventId: event.eventId } })).toBe(1);
    } finally {
      await consumer.disconnect();
      await p.disconnect();
      await Promise.all([topic.drop(), dlqTopic.drop()]);
    }
  });
});
