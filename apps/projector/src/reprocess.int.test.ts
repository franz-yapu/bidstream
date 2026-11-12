import { randomUUID } from 'node:crypto';
import {
  createKafkaAdmin,
  createProducer,
  type KafkaAdmin,
  type KafkaProducer,
} from '@bidstream/kafka';
import { PrismaLotRepository } from '@bidstream/db';
import type { EventConsumer, ProcessOutcome } from '@bidstream/consumer';
import { foldLot, type DomainEvent } from '@bidstream/domain';
import {
  collectMessages,
  createTestDatabase,
  createTestTopic,
  generateHistory,
  testKafkaConfig,
  waitFor,
  type TestDatabase,
  type TestTopic,
} from '@bidstream/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjector } from './projector.js';
import { GroupActiveError, reprocessProjection, waitForLagZero } from './reprocess.js';

// El reproceso de la spec §5: borrar la proyección, reposicionar el grupo y reconstruir desde el log.
const kafka = testKafkaConfig();
const history = generateHistory({ seed: 42, auctions: 4, lotsPerAuction: 3, bidsPerLot: 10 });
// Grupo propio de esta ejecución: el grupo `projector` es global en el clúster y los consumidores
// que deja colgados una ejecución anterior seguirían como miembros hasta que expire su sesión.
const GROUP = `projector-test-${randomUUID()}`;

let db: TestDatabase;
let events: TestTopic;
let dlq: TestTopic;
let producer: KafkaProducer;
let admin: KafkaAdmin;
let lots: PrismaLotRepository;

beforeAll(async () => {
  db = await createTestDatabase();
  [events, dlq] = await Promise.all([createTestTopic({ partitions: 6 }), createTestTopic()]);
  producer = await createProducer(kafka, { eventsTopic: events.name });
  admin = await createKafkaAdmin(kafka);
  lots = new PrismaLotRepository(db.prisma);
  for (const e of history) await producer.publishEvent(e);
});
afterAll(async () => {
  await admin.disconnect();
  await producer.disconnect();
  await Promise.all([events.drop(), dlq.drop()]);
  await db.drop();
});

/** Arranca `count` consumidores del grupo `projector` y espera a que reconstruyan todo el log. */
async function rebuild(
  count: number,
): Promise<{ outcomes: ProcessOutcome[]; stop(): Promise<void> }> {
  const outcomes: ProcessOutcome[] = [];
  const running: EventConsumer[] = [];
  for (let i = 0; i < count; i++) {
    const projector = await createProjector({
      groupId: GROUP,
      kafka,
      prisma: db.prisma,
      topics: [events.name],
      dlqTopic: dlq.name,
      retry: { baseDelayMs: 1, capMs: 2 },
      onOutcome: (o) => outcomes.push(o),
    });
    running.push(projector);
    void projector.run();
  }
  const stop = async (): Promise<void> => {
    await Promise.all(running.map((p) => p.disconnect()));
  };
  try {
    await waitFor(() => outcomes.length >= history.length, {
      timeoutMs: 60_000,
      description: `${String(history.length)} eventos reaplicados`,
    });
    await waitForLagZero(admin, GROUP, events.name);
  } catch (error) {
    await stop(); // nunca dejar consumidores vivos tras un fallo
    throw error;
  }
  return { outcomes, stop };
}

async function snapshot(): Promise<unknown> {
  const [auction, lot, bid] = await Promise.all([
    db.prisma.auction.findMany({ orderBy: { id: 'asc' } }),
    db.prisma.lot.findMany({ orderBy: { id: 'asc' } }),
    db.prisma.bid.findMany({ orderBy: { id: 'asc' } }),
  ]);
  // `processed_event` queda fuera: su `handled_at` es la hora real.
  return JSON.parse(JSON.stringify({ auction, lot, bid })) as unknown;
}

/** El oráculo: el estado que el dominio calcula, sin base de datos, para cada lote. */
async function expectMatchesDomain(): Promise<void> {
  const lotIds = history.filter((e) => e.type === 'LotPublished').map((e) => e.payload.lotId);
  expect(lotIds).toHaveLength(12);
  for (const lotId of lotIds) {
    const own: DomainEvent[] = history.filter(
      (e) => 'lotId' in e.payload && e.payload.lotId === lotId,
    );
    const tenant = history[0]?.tenantId ?? '';
    expect(await lots.findById(tenant, lotId)).toEqual(foldLot(own));
  }
  expect(await db.prisma.bid.count()).toBe(history.filter((e) => e.type === 'BidPlaced').length);
  const winners = history.filter(
    (e) => e.type === 'LotClosed' && e.payload.winnerId !== null,
  ).length;
  expect(await db.prisma.bid.count({ where: { awarded: true } })).toBe(winners);
}

const counts = async (): Promise<{ auction: number; lot: number; bid: number }> => ({
  auction: await db.prisma.auction.count(),
  lot: await db.prisma.lot.count(),
  bid: await db.prisma.bid.count(),
});

describe('reproceso desde el log', () => {
  let baseline: unknown;

  it('línea base: dos consumidores proyectan todo y el estado coincide con el del dominio', async () => {
    expect(history.length).toBeGreaterThan(100);
    const run = await rebuild(2);
    try {
      expect(run.outcomes.every((o) => o.kind === 'processed')).toBe(true);
      await expectMatchesDomain();
      baseline = await snapshot();
    } finally {
      await run.stop();
    }
  });

  it('sin confirmación explícita no hace nada', async () => {
    const before = await counts();
    await expect(
      reprocessProjection({
        prisma: db.prisma,
        kafka,
        topic: events.name,
        groupId: GROUP,
        yes: false,
      }),
    ).rejects.toThrow(/confirmación/);
    expect(await counts()).toEqual(before);
  });

  it('con el projector activo falla con GroupActiveError y no borra nada', async () => {
    const before = await counts();
    const outcomes: ProcessOutcome[] = [];
    const running = await createProjector({
      groupId: GROUP,
      kafka,
      prisma: db.prisma,
      topics: [events.name],
      dlqTopic: dlq.name,
      onOutcome: (o) => outcomes.push(o),
    });
    void running.run();
    try {
      await waitFor(async () => (await admin.describeGroup(GROUP))?.members === 1, {
        description: 'el projector se une al grupo',
      });
      await expect(
        reprocessProjection({
          prisma: db.prisma,
          kafka,
          topic: events.name,
          groupId: GROUP,
          yes: true,
        }),
      ).rejects.toThrow(GroupActiveError);
      expect(await counts()).toEqual(before);
    } finally {
      await running.disconnect();
    }
    await waitFor(async () => ((await admin.describeGroup(GROUP))?.members ?? 0) === 0, {
      description: 'el grupo queda vacío',
    });
  });

  it('reprocesar vacía la proyección y los registros del projector, y deja todo el log por leer', async () => {
    // otro consumidor tiene sus propios registros: no deben tocarse
    await db.prisma.processedEvent.create({
      data: { eventId: history[0]?.eventId ?? '', consumer: 'notifier' },
    });

    const result = await reprocessProjection({
      prisma: db.prisma,
      kafka,
      topic: events.name,
      groupId: GROUP,
      yes: true,
    });

    expect(result.eventsInLog).toBe(history.length);
    expect(await counts()).toEqual({ auction: 0, lot: 0, bid: 0 });
    const left = await db.pool.query<{ consumer: string; n: number }>(
      'SELECT consumer, count(*)::int AS n FROM processed_event GROUP BY consumer',
    );
    expect(left.rows).toEqual([{ consumer: 'notifier', n: 1 }]);
    expect((await admin.consumerLag(GROUP, events.name)).total).toBe(history.length);
  });

  it('reconstruir con dos consumidores en paralelo deja el MISMO estado, sin DLQ', async () => {
    const run = await rebuild(2);
    try {
      expect(run.outcomes.every((o) => o.kind === 'processed')).toBe(true);
      expect(await snapshot()).toEqual(baseline);
      await expectMatchesDomain();
      await expect(
        collectMessages({ topic: dlq.name, count: 1, timeoutMs: 3_000 }),
      ).rejects.toThrow(/se recibieron 0 de 1/);
    } finally {
      await run.stop();
    }
  });

  it('repetirlo (dos veces seguidas) y reconstruir con un solo consumidor da otra vez el mismo estado', async () => {
    await waitFor(async () => ((await admin.describeGroup(GROUP))?.members ?? 0) === 0, {
      description: 'el grupo queda vacío',
    });
    await reprocessProjection({
      prisma: db.prisma,
      kafka,
      topic: events.name,
      groupId: GROUP,
      yes: true,
    });
    await reprocessProjection({
      prisma: db.prisma,
      kafka,
      topic: events.name,
      groupId: GROUP,
      yes: true,
    }); // idempotente
    expect(await counts()).toEqual({ auction: 0, lot: 0, bid: 0 });

    const run = await rebuild(1);
    try {
      expect(await snapshot()).toEqual(baseline);
    } finally {
      await run.stop();
    }
  });
});
