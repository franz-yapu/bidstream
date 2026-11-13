import { randomUUID } from 'node:crypto';
import { buildEvent, type DomainEvent } from '@bidstream/domain';
import {
  createConsumer,
  createKafkaAdmin,
  createProducer,
  type KafkaAdmin,
} from '@bidstream/kafka';
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
import { buildDlqMessage } from './dlq.js';
import {
  DlqBusyError,
  MAX_REPROCESS,
  peekDlq,
  reprocessDlq,
  type DlqAdminOptions,
} from './dlq-admin.js';
import { createEventConsumer, type EventConsumer } from './event-consumer.js';
import type { ProcessOutcome } from './processor.js';

// Reproceso del DLQ contra Kafka y PostgreSQL reales. Cada prueba usa topics y un grupo de reproceso
// propios: los grupos son globales en el clúster y compartirlos mezclaría el estado entre pruebas.
const kafka = testKafkaConfig();
const TENANT = '11111111-1111-4111-8111-111111111111';
let db: TestDatabase;
let admin: KafkaAdmin;

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await createKafkaAdmin(kafka);
});
afterAll(async () => {
  await admin.disconnect();
  await db.drop();
});

interface Fixture {
  readonly events: TestTopic;
  readonly dlq: TestTopic;
  readonly options: DlqAdminOptions;
  readonly consumers: EventConsumer[];
  seed(entries: SeedEntry[]): Promise<DomainEvent[]>;
  teardown(): Promise<void>;
}

interface SeedEntry {
  readonly reason?: 'poison' | 'retries-exhausted';
  readonly reprocessCount?: number;
  /** Mensaje del DLQ que no cumple el formato. */
  readonly invalid?: boolean;
}

const lotEvent = (): DomainEvent =>
  buildEvent('LotClosed', TENANT, { lotId: randomUUID(), winnerId: null, finalAmount: null });

async function setup(): Promise<Fixture> {
  const [events, dlq] = await Promise.all([createTestTopic({ partitions: 2 }), createTestTopic()]);
  const producer = await createProducer(kafka);
  const consumers: EventConsumer[] = [];
  const options: DlqAdminOptions = {
    kafka,
    dlqTopic: dlq.name,
    reprocessorGroup: `dlq-reprocessor-test-${randomUUID()}`,
    timeoutMs: 20_000,
  };
  return {
    events,
    dlq,
    options,
    consumers,
    seed: async (entries) => {
      const created: DomainEvent[] = [];
      for (const entry of entries) {
        const event = lotEvent();
        created.push(event);
        if (entry.invalid === true) {
          await producer.publish(dlq.name, { key: 'x', value: '{esto no es un mensaje dlq' });
          continue;
        }
        const poison = entry.reason === 'poison';
        const original = poison ? '{evento roto' : JSON.stringify(event);
        const dlqMessage = buildDlqMessage({
          message: {
            topic: events.name,
            partition: 0,
            offset: '7',
            key: (event.payload as { lotId: string }).lotId,
            value: original,
            headers: { 'x-reprocess-count': String(entry.reprocessCount ?? 0) },
          },
          consumer: 'projector',
          error: new Error('fallo simulado'),
          attempts: poison ? 1 : 4,
          reason: entry.reason ?? 'retries-exhausted',
          now: new Date(),
        });
        await producer.publish(dlq.name, {
          key: (event.payload as { lotId: string }).lotId,
          value: JSON.stringify(dlqMessage),
        });
      }
      return created;
    },
    teardown: async () => {
      await Promise.all(consumers.map((c) => c.disconnect()));
      await producer.disconnect();
      await Promise.all([events.drop(), dlq.drop()]);
    },
  };
}

const lotOf = (event: DomainEvent): string => (event.payload as { lotId: string }).lotId;

describe('peekDlq', () => {
  it('lista el contenido sin consumirlo (dos llamadas dan lo mismo) y no incluye el valor original salvo que se pida', async () => {
    const fx = await setup();
    try {
      const created = await fx.seed([{}, { reason: 'poison' }, { reprocessCount: 2 }]);
      const first = await peekDlq(fx.options);
      const second = await peekDlq(fx.options);
      expect(second).toEqual(first);
      expect(first.total).toBe(3);
      expect(first.pending).toBe(3);
      expect(first.entries.map((e) => e.reason)).toEqual([
        'retries-exhausted',
        'poison',
        'retries-exhausted',
      ]);
      expect(first.entries[0]).toMatchObject({
        eventId: created[0]?.eventId,
        type: 'LotClosed',
        consumer: 'projector',
        attempts: 4,
        reprocessCount: 0,
        error: { message: 'fallo simulado' },
      });
      expect(first.entries[1]).toMatchObject({ eventId: null, type: null }); // el veneno no tiene evento
      expect(first.entries[2]?.reprocessCount).toBe(2);
      expect(first.entries[0]).not.toHaveProperty('original');
      const withOriginal = await peekDlq({ ...fx.options, includeOriginal: true });
      expect(withOriginal.entries[0]?.original).toBe(JSON.stringify(created[0]));
    } finally {
      await fx.teardown();
    }
  });

  it('con un DLQ vacío devuelve todo a cero sin esperar', async () => {
    const fx = await setup();
    try {
      const started = Date.now();
      expect(await peekDlq(fx.options)).toEqual({ entries: [], pending: 0, total: 0 });
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      await fx.teardown();
    }
  });
});

describe('reprocessDlq: pendientes', () => {
  it('republica los retries-exhausted intactos, con su clave y las cabeceras, y salta veneno e inválidos', async () => {
    const fx = await setup();
    try {
      const created = await fx.seed([
        {},
        {},
        {},
        { reason: 'poison' },
        { reprocessCount: MAX_REPROCESS },
        { invalid: true },
      ]);
      const summary = await reprocessDlq(fx.options);
      expect(summary).toMatchObject({
        mode: 'pending',
        examined: 6,
        republished: 3,
        skipped: { poison: 1, tooManyAttempts: 1, notSelected: 0, invalid: 1 },
        notFound: [],
        remaining: 0,
      });
      expect(summary.republishedEventIds).toEqual(created.slice(0, 3).map((e) => e.eventId));

      const messages = await collectMessages({ topic: fx.events.name, count: 3 });
      for (const m of messages) {
        const source = created.slice(0, 3).find((e) => lotOf(e) === m.key);
        expect(source).toBeDefined();
        expect(m.value).toBe(JSON.stringify(source));
        expect(m.headers).toMatchObject({
          eventId: source?.eventId,
          type: 'LotClosed',
          version: '1',
          'x-reprocess-count': '1',
        });
        expect(m.headers['x-dlq-source']).toBe(`${fx.events.name}:0:7`);
      }
    } finally {
      await fx.teardown();
    }
  });

  it('una segunda llamada no repite nada (el offset quedó confirmado)', async () => {
    const fx = await setup();
    try {
      await fx.seed([{}, {}]);
      expect((await reprocessDlq(fx.options)).republished).toBe(2);
      expect(await reprocessDlq(fx.options)).toMatchObject({
        examined: 0,
        republished: 0,
        remaining: 0,
      });
    } finally {
      await fx.teardown();
    }
  });

  it('respeta limit y la siguiente llamada continúa donde terminó la anterior', async () => {
    const fx = await setup();
    try {
      const created = await fx.seed([{}, {}, {}, {}, {}]);
      const first = await reprocessDlq({ ...fx.options, limit: 2 });
      expect(first).toMatchObject({ examined: 2, republished: 2, remaining: 3 });
      const second = await reprocessDlq({ ...fx.options, limit: 10 });
      expect(second).toMatchObject({ examined: 3, republished: 3, remaining: 0 });
      expect([...first.republishedEventIds, ...second.republishedEventIds]).toEqual(
        created.map((e) => e.eventId),
      );
    } finally {
      await fx.teardown();
    }
  });

  it('si otro reproceso está en marcha (el grupo tiene miembros) lanza DlqBusyError y no toca nada', async () => {
    const fx = await setup();
    try {
      await fx.seed([{}]);
      const holder = await createConsumer(kafka, {
        groupId: fx.options.reprocessorGroup ?? '',
        topics: [fx.dlq.name],
      });
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => (release = resolve));
      void holder.run(() => held); // retiene el grupo sin confirmar nada
      try {
        await waitFor(
          async () =>
            ((await admin.describeGroup(fx.options.reprocessorGroup ?? ''))?.members ?? 0) > 0,
          {
            description: 'el grupo tiene un miembro',
          },
        );
        await expect(reprocessDlq(fx.options)).rejects.toThrow(DlqBusyError);
      } finally {
        release();
        await holder.disconnect().catch(() => undefined);
      }
    } finally {
      await fx.teardown();
    }
  });
});

describe('reprocessDlq: selectivo', () => {
  it('republica solo los eventIds pedidos, informa los que no están y NO altera lo pendiente', async () => {
    const fx = await setup();
    try {
      const created = await fx.seed([{}, {}, {}, {}]);
      const missing = randomUUID();
      const summary = await reprocessDlq({
        ...fx.options,
        eventIds: [created[1]?.eventId ?? '', created[3]?.eventId ?? '', missing],
      });
      expect(summary).toMatchObject({
        mode: 'selective',
        examined: 4,
        republished: 2,
        skipped: { notSelected: 2 },
        notFound: [missing],
        remaining: 4, // el grupo de pendientes no avanzó
      });
      expect([...summary.republishedEventIds].sort()).toEqual(
        [created[1]?.eventId, created[3]?.eventId].sort(),
      );
      // lo pendiente sigue intacto: el modo por defecto sigue viendo los 4
      expect((await peekDlq(fx.options)).pending).toBe(4);
    } finally {
      await fx.teardown();
    }
  });

  it('también aplica el tope de reprocesos y no republica un veneno aunque se pida', async () => {
    const fx = await setup();
    try {
      const created = await fx.seed([{ reprocessCount: MAX_REPROCESS }, { reason: 'poison' }, {}]);
      const summary = await reprocessDlq({
        ...fx.options,
        eventIds: created.map((e) => e.eventId),
      });
      expect(summary.republished).toBe(1);
      // el veneno no se puede identificar por eventId (su contenido está roto): cuenta como no
      // seleccionado y su id figura entre los no encontrados; nunca se republica
      expect(summary.skipped).toMatchObject({ tooManyAttempts: 1, notSelected: 1, poison: 0 });
      expect(summary.notFound).toEqual([created[1]?.eventId]);
    } finally {
      await fx.teardown();
    }
  });
});

interface Cycle {
  readonly fx: Fixture;
  readonly outcomes: Map<string, ProcessOutcome[]>;
  readonly behaviour: { failA: boolean };
  readonly applied: string[];
}

/** Dos consumidores (grupos distintos) sobre el mismo topic: A puede fallar a voluntad; B siempre funciona. */
async function cycle(): Promise<Cycle> {
  const fx = await setup();
  const outcomes = new Map<string, ProcessOutcome[]>([
    ['A', []],
    ['B', []],
  ]);
  const behaviour = { failA: true };
  const applied: string[] = [];
  for (const name of ['A', 'B'] as const) {
    const consumer = await createEventConsumer({
      kafka,
      prisma: db.prisma,
      consumerName: `ciclo-${name}-${randomUUID()}`,
      topics: [fx.events.name],
      dlqTopic: fx.dlq.name,
      retry: { baseDelayMs: 1, capMs: 2 },
      handler: (event) => {
        if (name === 'A' && behaviour.failA)
          return Promise.reject(new Error('base de datos caída'));
        if (name === 'A') applied.push(event.eventId);
        return Promise.resolve();
      },
      onOutcome: (o) => outcomes.get(name)?.push(o),
    });
    fx.consumers.push(consumer);
    void consumer.run();
  }
  return { fx, outcomes, behaviour, applied };
}

describe('ciclo completo: fallo → DLQ → reproceso → procesado', () => {
  it('un fallo transitorio se recupera: A lo procesa tras el reproceso y B lo ignora como duplicado', async () => {
    const { fx, outcomes, behaviour, applied } = await cycle();
    try {
      const event = lotEvent();
      const producer = await createProducer(kafka, { eventsTopic: fx.events.name });
      await producer.publishEvent(event);
      await producer.disconnect();

      await waitFor(
        () => (outcomes.get('A')?.length ?? 0) === 1 && (outcomes.get('B')?.length ?? 0) === 1,
        {
          description: 'A y B resuelven el evento',
        },
      );
      expect(outcomes.get('A')?.[0]).toMatchObject({
        kind: 'dead-lettered',
        reason: 'retries-exhausted',
      });
      expect(outcomes.get('B')?.[0]).toEqual({ kind: 'processed', attempts: 1 });
      expect(applied).toEqual([]);
      expect((await peekDlq(fx.options)).entries[0]).toMatchObject({
        eventId: event.eventId,
        reprocessCount: 0,
      });

      behaviour.failA = false; // se arregla la causa (la base vuelve)
      const summary = await reprocessDlq(fx.options);
      expect(summary).toMatchObject({ republished: 1, republishedEventIds: [event.eventId] });

      await waitFor(
        () => (outcomes.get('A')?.length ?? 0) === 2 && (outcomes.get('B')?.length ?? 0) === 2,
        {
          description: 'ambos reciben el reenvío',
        },
      );
      expect(outcomes.get('A')?.[1]).toEqual({ kind: 'processed', attempts: 1 }); // aplicado una sola vez
      expect(outcomes.get('B')?.[1]).toEqual({ kind: 'duplicate' }); // ya lo había procesado
      expect(applied).toEqual([event.eventId]);
    } finally {
      await fx.teardown();
    }
  });

  it('un fallo permanente NO hace un bucle infinito: tras 3 reprocesos el evento deja de republicarse', async () => {
    const { fx, outcomes } = await cycle(); // A falla siempre (failA nunca se desactiva)
    try {
      const event = lotEvent();
      const producer = await createProducer(kafka, { eventsTopic: fx.events.name });
      await producer.publishEvent(event);
      await producer.disconnect();
      await waitFor(() => (outcomes.get('A')?.length ?? 0) === 1, {
        description: 'primer fallo de A',
      });

      for (let run = 1; run <= MAX_REPROCESS; run++) {
        const summary = await reprocessDlq(fx.options);
        expect(summary).toMatchObject({ examined: 1, republished: 1 });
        // A vuelve a fallar y deja un mensaje nuevo en el DLQ con el contador incrementado
        await waitFor(() => (outcomes.get('A')?.length ?? 0) === run + 1, {
          description: `fallo número ${String(run + 1)}`,
        });
        await waitFor(async () => (await peekDlq(fx.options)).total === run + 1, {
          description: 'nuevo mensaje en el DLQ',
        });
      }

      const counts = (await peekDlq(fx.options)).entries.map((e) => e.reprocessCount);
      expect(counts).toEqual([0, 1, 2, 3]);

      // el cuarto intento encuentra reprocessCount = 3: se detiene y no republica
      const last = await reprocessDlq(fx.options);
      expect(last).toMatchObject({
        examined: 1,
        republished: 0,
        skipped: { tooManyAttempts: 1 },
        remaining: 0,
      });
      await new Promise((r) => setTimeout(r, 500));
      expect(outcomes.get('A')?.length).toBe(MAX_REPROCESS + 1); // ya no llegan más fallos
      expect((await peekDlq(fx.options)).total).toBe(MAX_REPROCESS + 1);
    } finally {
      await fx.teardown();
    }
  });
});
