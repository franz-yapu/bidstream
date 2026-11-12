import { buildEvent, type DomainEvent } from '@bidstream/domain';
import { createEventConsumer } from '@bidstream/consumer';
import { PrismaOutbox, type PrismaClient } from '@bidstream/db';
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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tryAcquireLeadership } from './leader.js';
import { OutboxRelay, type PublishRequest } from './relay.js';

const kafka = testKafkaConfig();
const TENANT = '11111111-1111-4111-8111-111111111111';
const LOTS = [
  '00000001-0000-4000-8000-000000000000',
  '00000002-0000-4000-8000-000000000000',
  '00000003-0000-4000-8000-000000000000',
];

let db: TestDatabase;
let producer: KafkaProducer;

beforeAll(async () => {
  db = await createTestDatabase();
  producer = await createProducer(kafka);
});
afterAll(async () => {
  await producer.disconnect();
  await db.drop();
});
// Cada prueba parte de un outbox vacío (los topics de pruebas anteriores ya no existen).
beforeEach(async () => {
  await db.pool.query('TRUNCATE outbox_message');
});

const closed = (lotId: string): DomainEvent =>
  buildEvent('LotClosed', TENANT, { lotId, winnerId: null, finalAmount: null });

/** Encola `count` eventos entrelazando los tres lotes, cada uno en su propia transacción. */
async function enqueue(topic: string, count = 12): Promise<DomainEvent[]> {
  const events: DomainEvent[] = [];
  for (let i = 0; i < count; i++) {
    const event = closed(LOTS[i % LOTS.length] ?? LOTS[0] ?? '');
    await new PrismaOutbox(db.prisma).enqueue([event], topic);
    events.push(event);
  }
  return events;
}

const publishVia =
  (target: KafkaProducer) =>
  (request: PublishRequest): Promise<void> =>
    target.publish(request.topic, {
      key: request.key,
      value: request.value,
      headers: request.headers,
    });

/** Los métodos de un cliente Prisma envuelto en un Proxy deben seguir ligados al objeto original. */
function bindIfFunction(value: unknown, self: object): unknown {
  return typeof value === 'function' ? (value as (...args: never[]) => unknown).bind(self) : value;
}

const pending = async (): Promise<number> => {
  const { rows } = await db.pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM outbox_message WHERE published_at IS NULL',
  );
  return rows[0]?.n ?? 0;
};

function makeRelay(
  publish: (request: PublishRequest) => Promise<void>,
  extra: Partial<ConstructorParameters<typeof OutboxRelay>[0]> = {},
): OutboxRelay {
  return new OutboxRelay({ prisma: db.prisma, databaseUrl: db.url, publish, ...extra });
}

describe('publicación', () => {
  it('publica todo lo pendiente con su clave y cabeceras, y lo marca como publicado', async () => {
    const topic: TestTopic = await createTestTopic({ partitions: 3 });
    try {
      const events = await enqueue(topic.name);
      const result = await makeRelay(publishVia(producer)).runOnce();
      expect(result).toEqual({ published: 12 });
      expect(await pending()).toBe(0);

      const messages = await collectMessages({ topic: topic.name, count: 12 });
      for (const m of messages) {
        const source = events.find((e) => e.eventId === m.headers['eventId']);
        expect(source).toBeDefined();
        expect(m.key).toBe((source as DomainEvent & { type: 'LotClosed' }).payload.lotId);
        expect(m.headers).toMatchObject({ type: 'LotClosed', version: '1' });
        expect(JSON.parse(m.value ?? 'null')).toEqual(JSON.parse(JSON.stringify(source)));
      }
    } finally {
      await topic.drop();
    }
  });

  it('para cada lote conserva el orden de (created_at, id) al llegar a Kafka', async () => {
    const topic = await createTestTopic({ partitions: 3 });
    try {
      const events = await enqueue(topic.name);
      await makeRelay(publishVia(producer)).runOnce();
      const messages = await collectMessages({ topic: topic.name, count: 12 });
      for (const lot of LOTS) {
        const expected = events
          .filter((e) => (e as DomainEvent & { type: 'LotClosed' }).payload.lotId === lot)
          .map((e) => e.eventId);
        const got = messages.filter((m) => m.key === lot).map((m) => m.headers['eventId']);
        expect(got).toEqual(expected);
      }
    } finally {
      await topic.drop();
    }
  });

  it('una fila ya publicada no se vuelve a publicar', async () => {
    const topic = await createTestTopic();
    try {
      await enqueue(topic.name, 5);
      let calls = 0;
      const relay = makeRelay((r) => {
        calls += 1;
        return publishVia(producer)(r);
      });
      expect((await relay.runOnce()).published).toBe(5);
      expect(await relay.runOnce()).toEqual({ published: 0 });
      expect(calls).toBe(5);
    } finally {
      await topic.drop();
    }
  });

  it('con el outbox vacío no publica nada', async () => {
    let calls = 0;
    const relay = makeRelay(() => {
      calls += 1;
      return Promise.resolve();
    });
    expect(await relay.runOnce()).toEqual({ published: 0 });
    expect(calls).toBe(0);
  });
});

describe('fallos', () => {
  it('si Kafka falla en el mensaje n: confirma las anteriores y la ronda siguiente continúa desde la n, sin saltos', async () => {
    await enqueue('cualquiera', 6);
    const order: string[] = [];
    let calls = 0;
    const relay = makeRelay((request) => {
      calls += 1;
      if (calls === 3) return Promise.reject(new Error('kafka caído'));
      order.push(request.headers['eventId'] ?? '');
      return Promise.resolve();
    });

    const first = await relay.runOnce();
    expect(first.published).toBe(2);
    expect(first.error).toBeInstanceOf(Error);
    expect(await pending()).toBe(4);

    const second = await relay.runOnce();
    expect(second).toEqual({ published: 4 });
    expect(await pending()).toBe(0);

    const { rows } = await db.pool.query<{ id: string }>(
      'SELECT id FROM outbox_message ORDER BY created_at, id',
    );
    // cada mensaje exactamente una vez y en el orden del outbox
    expect(order).toEqual(rows.map((r) => r.id));
  });

  it('si falla el marcado tras publicar, se vuelve a publicar (al menos una vez) y luego queda marcado', async () => {
    await enqueue('cualquiera', 4);
    let left = 1;
    const flaky = {
      $transaction: (fn: (tx: unknown) => Promise<unknown>, options?: unknown) =>
        db.prisma.$transaction(
          (tx) =>
            fn(
              new Proxy(tx, {
                get(target, prop) {
                  const value: unknown = Reflect.get(target, prop);
                  if (prop === 'outboxMessage') {
                    return new Proxy(value as object, {
                      get(inner, p) {
                        if (p === 'updateMany' && left > 0) {
                          return () => {
                            left -= 1;
                            return Promise.reject(new Error('fallo al marcar'));
                          };
                        }
                        const member: unknown = Reflect.get(inner, p);
                        return bindIfFunction(member, inner);
                      },
                    });
                  }
                  return bindIfFunction(value, target);
                },
              }),
            ),
          options as never,
        ),
    } as unknown as Pick<PrismaClient, '$transaction'>;

    const sent: string[] = [];
    const relay = new OutboxRelay({
      prisma: flaky,
      publish: (r) => {
        sent.push(r.headers['eventId'] ?? '');
        return Promise.resolve();
      },
    });

    const first = await relay.runOnce();
    expect(first.published).toBe(0);
    expect(first.error).toBeInstanceOf(Error);
    expect(await pending()).toBe(4); // la transacción se revirtió

    expect(await relay.runOnce()).toEqual({ published: 4 });
    expect(sent).toHaveLength(8); // duplicados esperados en «al menos una vez»
    expect(new Set(sent).size).toBe(4);
    expect(await pending()).toBe(0);
  });

  it('ante fallos repetidos espera con backoff creciente (sleep inyectado)', async () => {
    await enqueue('cualquiera', 1);
    const delays: number[] = [];
    const relay = makeRelay(() => Promise.reject(new Error('siempre falla')), {
      random: () => 1,
      backoff: { baseMs: 100, capMs: 250 },
      sleep: (ms) => {
        delays.push(ms);
        if (delays.length >= 4) void relay.stop();
        return Promise.resolve();
      },
    });
    await relay.start();
    expect(delays).toEqual([100, 200, 250, 250]);
    expect(await pending()).toBe(1); // nunca se salta el mensaje
  });
});

describe('concurrencia y liderazgo', () => {
  it('claimPending bloquea las filas: otra transacción no las ve hasta el commit', async () => {
    await enqueue('cualquiera', 3);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let claimed!: () => void;
    const claimedSignal = new Promise<void>((resolve) => {
      claimed = resolve;
    });
    const holder = db.prisma.$transaction(
      async (tx) => {
        const rows = await new PrismaOutbox(tx).claimPending(10);
        claimed();
        await gate;
        return rows.length;
      },
      { timeout: 20_000 },
    );
    await claimedSignal;

    const seenByOther = await db.prisma.$transaction((tx) => new PrismaOutbox(tx).claimPending(10));
    expect(seenByOther).toHaveLength(0);

    release();
    expect(await holder).toBe(3);
    const after = await db.prisma.$transaction((tx) => new PrismaOutbox(tx).claimPending(10));
    expect(after).toHaveLength(3); // no se marcaron: siguen pendientes
  });

  it('solo un proceso obtiene el liderazgo; al liberarlo, otro lo adquiere', async () => {
    const first = await tryAcquireLeadership(db.url);
    expect(first).not.toBeNull();
    expect(await tryAcquireLeadership(db.url)).toBeNull();
    await first?.release();
    const second = await tryAcquireLeadership(db.url);
    expect(second).not.toBeNull();
    await second?.release();
  });

  it('dos relays: solo uno publica; al detener al líder, el otro continúa', async () => {
    const topic = await createTestTopic();
    try {
      const counts = { a: 0, b: 0 };
      const fast = { pollIntervalMs: 20, standbyPollMs: 40 };
      const a = makeRelay((r) => {
        counts.a += 1;
        return publishVia(producer)(r);
      }, fast);
      const b = makeRelay((r) => {
        counts.b += 1;
        return publishVia(producer)(r);
      }, fast);
      void a.start();
      void b.start();

      await enqueue(topic.name, 4);
      await waitFor(async () => (await pending()) === 0, { description: 'primer lote publicado' });
      expect(counts.a + counts.b).toBe(4);
      expect(counts.a === 0 || counts.b === 0).toBe(true); // un solo líder

      const leader = counts.a > 0 ? a : b;
      const standby = counts.a > 0 ? b : a;
      const standbyKey = counts.a > 0 ? 'b' : 'a';
      await leader.stop();

      await enqueue(topic.name, 3);
      await waitFor(async () => (await pending()) === 0, { description: 'segundo lote publicado' });
      expect(counts[standbyKey]).toBe(3);
      await standby.stop();
    } finally {
      await topic.drop();
    }
  });

  it('stop() termina la ronda en curso, marca lo publicado y libera el liderazgo', async () => {
    const topic = await createTestTopic();
    try {
      await enqueue(topic.name, 5);
      const relay = makeRelay(
        async (r) => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          await publishVia(producer)(r);
        },
        { pollIntervalMs: 20 },
      );
      void relay.start();
      await waitFor(async () => (await pending()) < 5, { description: 'primer mensaje marcado' });
      await relay.stop();

      // nada publicado quedó sin marcar: lo marcado coincide con lo que hay en Kafka
      const marked = 5 - (await pending());
      expect(marked).toBeGreaterThan(0);
      const received = await collectMessages({ topic: topic.name, count: marked });
      expect(received).toHaveLength(marked);
      const again = await tryAcquireLeadership(db.url); // liberado
      expect(again).not.toBeNull();
      await again?.release();
    } finally {
      await topic.drop();
    }
  });
});

describe('contrato con el consumidor base (D3)', () => {
  it('un evento escrito con PrismaOutbox y publicado por el relay lo procesa createEventConsumer', async () => {
    const [events, dlq] = await Promise.all([createTestTopic(), createTestTopic()]);
    const [event] = await enqueue(events.name, 1);
    const seen: DomainEvent[] = [];
    const outcomes: string[] = [];
    const consumer = await createEventConsumer({
      kafka,
      prisma: db.prisma,
      consumerName: 'projector',
      topics: [events.name],
      dlqTopic: dlq.name,
      handler: (e) => {
        seen.push(e);
        return Promise.resolve();
      },
      onOutcome: (o) => outcomes.push(o.kind),
    });
    try {
      void consumer.run();
      await makeRelay(publishVia(producer)).runOnce();
      await waitFor(() => outcomes.length === 1, { description: 'evento procesado' });
      expect(outcomes).toEqual(['processed']);
      expect(seen[0]).toEqual(JSON.parse(JSON.stringify(event)));
    } finally {
      await consumer.disconnect();
      await Promise.all([events.drop(), dlq.drop()]);
    }
  });
});
