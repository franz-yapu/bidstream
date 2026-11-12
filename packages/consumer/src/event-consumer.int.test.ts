import { randomUUID } from 'node:crypto';
import { buildEvent, type DomainEvent } from '@bidstream/domain';
import { createProducer, type KafkaProducer } from '@bidstream/kafka';
import {
  collectMessages,
  createTestDatabase,
  createTestTopic,
  testKafkaConfig,
  waitFor,
  type TestDatabase,
  type TestTopic,
} from '@bidstream/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dlqMessageSchema } from './dlq.js';
import { createEventConsumer, type EventConsumer } from './event-consumer.js';
import type { EventHandler, ProcessOutcome } from './processor.js';

const kafka = testKafkaConfig();
const TENANT = '11111111-1111-4111-8111-111111111111';
let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.drop();
});

const closed = (lotId = randomUUID()): DomainEvent =>
  buildEvent('LotClosed', TENANT, { lotId, winnerId: null, finalAmount: null });

interface Fixture {
  readonly events: TestTopic;
  readonly dlq: TestTopic;
  readonly producer: KafkaProducer;
  readonly outcomes: ProcessOutcome[];
  start(name: string, handler: EventHandler): Promise<EventConsumer>;
  stop(): Promise<void>;
}

/** Topics de eventos y DLQ propios para cada prueba, para que no se mezclen entre sí. */
async function setup(): Promise<Fixture> {
  const [events, dlq] = await Promise.all([createTestTopic(), createTestTopic()]);
  const producer = await createProducer(kafka, { eventsTopic: events.name });
  const consumers: EventConsumer[] = [];
  const outcomes: ProcessOutcome[] = [];
  return {
    events,
    dlq,
    producer,
    outcomes,
    start: async (name, handler) => {
      const consumer = await createEventConsumer({
        kafka,
        prisma: db.prisma,
        consumerName: name,
        handler,
        topics: [events.name],
        dlqTopic: dlq.name,
        retry: { baseDelayMs: 1, capMs: 2 },
        onOutcome: (outcome) => outcomes.push(outcome),
      });
      consumers.push(consumer);
      void consumer.run();
      return consumer;
    },
    stop: async () => {
      await Promise.all(consumers.map((c) => c.disconnect()));
      await producer.disconnect();
      await Promise.all([events.drop(), dlq.drop()]);
    },
  };
}

const count = async (sql: string, params: unknown[] = []): Promise<number> => {
  const { rows } = await db.pool.query<{ n: number }>(sql, params);
  return rows[0]?.n ?? 0;
};

describe('consumidor base (PostgreSQL y Kafka reales)', () => {
  it('un evento entregado dos veces ejecuta el handler una sola vez', async () => {
    const f = await setup();
    try {
      let calls = 0;
      await f.start('projector', () => {
        calls += 1;
        return Promise.resolve();
      });
      const e = closed();
      await f.producer.publishEvent(e);
      await f.producer.publishEvent(e);
      await waitFor(() => f.outcomes.length === 2, { description: 'dos resultados' });
      expect(f.outcomes.map((o) => o.kind)).toEqual(['processed', 'duplicate']);
      expect(calls).toBe(1);
      expect(
        await count('SELECT count(*)::int AS n FROM processed_event WHERE event_id = $1', [
          e.eventId,
        ]),
      ).toBe(1);
    } finally {
      await f.stop();
    }
  });

  it('dos consumidores distintos procesan cada uno el mismo evento', async () => {
    const f = await setup();
    try {
      const calls = { projector: 0, notifier: 0 };
      await f.start('projector', () => {
        calls.projector += 1;
        return Promise.resolve();
      });
      await f.start('notifier', () => {
        calls.notifier += 1;
        return Promise.resolve();
      });
      const e = closed();
      await f.producer.publishEvent(e);
      // los resultados se emiten tras el commit: esperar a los handlers no basta
      await waitFor(() => f.outcomes.length === 2, { description: 'ambos consumidores' });
      expect(calls).toEqual({ projector: 1, notifier: 1 });
      expect(
        await count('SELECT count(*)::int AS n FROM processed_event WHERE event_id = $1', [
          e.eventId,
        ]),
      ).toBe(2);
    } finally {
      await f.stop();
    }
  });

  it('un handler que falla dos veces y luego funciona: 3 ejecuciones, un registro, sin DLQ', async () => {
    const f = await setup();
    try {
      let calls = 0;
      await f.start('projector', () => {
        calls += 1;
        return calls <= 2 ? Promise.reject(new Error('fallo transitorio')) : Promise.resolve();
      });
      const e = closed();
      await f.producer.publishEvent(e);
      await waitFor(() => f.outcomes.length === 1, { description: 'un resultado' });
      expect(f.outcomes[0]).toEqual({ kind: 'processed', attempts: 3 });
      expect(calls).toBe(3);
      expect(
        await count('SELECT count(*)::int AS n FROM processed_event WHERE event_id = $1', [
          e.eventId,
        ]),
      ).toBe(1);
      await expect(
        collectMessages({ topic: f.dlq.name, count: 1, timeoutMs: 3_000 }),
      ).rejects.toThrow(/se recibieron 0 de 1/);
    } finally {
      await f.stop();
    }
  });

  it('un handler que siempre falla: 4 intentos, DLQ con el error, sin registro, y el siguiente se procesa', async () => {
    const f = await setup();
    try {
      const attempts: string[] = [];
      const bad = closed();
      const good = closed();
      await f.start('projector', (event) => {
        attempts.push(event.eventId);
        return event.eventId === bad.eventId
          ? Promise.reject(new Error('fallo permanente'))
          : Promise.resolve();
      });
      await f.producer.publishEvent(bad);
      await f.producer.publishEvent(good);
      await waitFor(() => f.outcomes.length === 2, { description: 'dos resultados' });

      expect(f.outcomes).toEqual([
        { kind: 'dead-lettered', reason: 'retries-exhausted', attempts: 4 },
        { kind: 'processed', attempts: 1 },
      ]);
      expect(attempts.filter((id) => id === bad.eventId)).toHaveLength(4);

      const [dlqMessage] = await collectMessages({ topic: f.dlq.name, count: 1 });
      const dlq = dlqMessageSchema.parse(JSON.parse(dlqMessage?.value ?? 'null'));
      expect(dlq).toMatchObject({
        consumer: 'projector',
        attempts: 4,
        reason: 'retries-exhausted',
        error: { message: 'fallo permanente' },
        source: { topic: f.events.name },
      });
      expect(JSON.parse(dlq.original ?? 'null')).toEqual(JSON.parse(JSON.stringify(bad)));
      expect(dlqMessage?.headers).toMatchObject({ consumer: 'projector', eventId: bad.eventId });

      expect(
        await count('SELECT count(*)::int AS n FROM processed_event WHERE event_id = $1', [
          bad.eventId,
        ]),
      ).toBe(0);
      expect(
        await count('SELECT count(*)::int AS n FROM processed_event WHERE event_id = $1', [
          good.eventId,
        ]),
      ).toBe(1);
    } finally {
      await f.stop();
    }
  });

  it('un efecto escrito en la transacción se revierte cuando el handler falla después', async () => {
    const f = await setup();
    const marker = randomUUID();
    try {
      await f.start('projector', async (_event, { tx }) => {
        await tx.outboxMessage.create({
          data: { id: randomUUID(), topic: 'efecto', key: marker, payload: {} },
        });
        throw new Error('falla después de escribir');
      });
      await f.producer.publishEvent(closed());
      await waitFor(() => f.outcomes.length === 1, { description: 'un resultado' });
      expect(f.outcomes[0]?.kind).toBe('dead-lettered');
      expect(
        await count('SELECT count(*)::int AS n FROM outbox_message WHERE key = $1', [marker]),
      ).toBe(0);
    } finally {
      await f.stop();
    }
  });

  it('mensajes con JSON o contrato inválidos van al DLQ como veneno, sin reintentos', async () => {
    const f = await setup();
    try {
      let calls = 0;
      await f.start('projector', () => {
        calls += 1;
        return Promise.resolve();
      });
      await f.producer.publish(f.events.name, { key: 'k', value: '{esto no es json' });
      await f.producer.publish(f.events.name, {
        key: 'k',
        value: JSON.stringify({ type: 'LotClosed' }),
      });
      await waitFor(() => f.outcomes.length === 2, { description: 'dos resultados' });
      expect(f.outcomes).toEqual([
        { kind: 'dead-lettered', reason: 'poison', attempts: 1 },
        { kind: 'dead-lettered', reason: 'poison', attempts: 1 },
      ]);
      expect(calls).toBe(0);
      const messages = await collectMessages({ topic: f.dlq.name, count: 2 });
      const parsed = messages.map((m) => dlqMessageSchema.parse(JSON.parse(m.value ?? 'null')));
      expect(parsed.map((p) => p.reason)).toEqual(['poison', 'poison']);
      expect(parsed[0]?.original).toBe('{esto no es json');
    } finally {
      await f.stop();
    }
  });

  it('los eventos de un mismo lote se procesan en orden aun con un reintento en medio', async () => {
    const f = await setup();
    try {
      const lotId = randomUUID();
      const [e1, e2, e3] = [closed(lotId), closed(lotId), closed(lotId)] as [
        DomainEvent,
        DomainEvent,
        DomainEvent,
      ];
      const calls: string[] = [];
      const done: string[] = [];
      let failedOnce = false;
      await f.start('projector', (event) => {
        calls.push(event.eventId);
        if (event.eventId === e2.eventId && !failedOnce) {
          failedOnce = true;
          return Promise.reject(new Error('fallo en el segundo'));
        }
        done.push(event.eventId);
        return Promise.resolve();
      });
      for (const e of [e1, e2, e3]) await f.producer.publishEvent(e);
      await waitFor(() => f.outcomes.length === 3, { description: 'tres resultados' });
      expect(calls).toEqual([e1, e2, e2, e3].map((e) => e.eventId));
      expect(done).toEqual([e1, e2, e3].map((e) => e.eventId));
    } finally {
      await f.stop();
    }
  });
});
