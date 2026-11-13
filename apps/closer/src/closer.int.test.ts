import { randomUUID } from 'node:crypto';
import { buildApp, loadConfig, Uuid7Generator } from '@bidstream/api';
import { createDecider, type Decider } from '@bidstream/decider';
import { createProjector } from '@bidstream/projector';
import { applyEventToDecision, PrismaOutbox, tryAcquireLeadership } from '@bidstream/db';
import { createEventConsumer, type EventConsumer } from '@bidstream/consumer';
import {
  buildCommand,
  buildEvent,
  FixedClock,
  parseEvent,
  type DomainEvent,
} from '@bidstream/domain';
import { createProducer, type KafkaProducer } from '@bidstream/kafka';
import { OutboxRelay } from '@bidstream/relay';
import {
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
import { Closer, CLOSER_LOCK_KEY } from './closer.js';

// D8: el closer da la señal de tiempo; el decisor decide el cierre por la misma partición que las
// pujas. Todo real: PostgreSQL, Kafka, relay, decisor y projector. El reloj de la API y el del closer
// se controlan para que el tiempo sea determinista.
const kafka = testKafkaConfig();
const TENANT = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-14T12:00:00.000Z');
const ANTI_SNIPING = { windowMs: 60_000, extensionMs: 60_000 };
const at = (time: string): Date => new Date(`2026-11-14T${time}.000Z`);
const newId = (): string => new Uuid7Generator().newId();
const bidders = Array.from({ length: 4 }, () => randomUUID());

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

const closer = (now: Date, overrides: { cleanupEveryMs?: number } = {}) =>
  new Closer({
    prisma: db.prisma,
    commandsTopic: commands.name,
    eventsTopic: events.name,
    now: () => now,
    ...overrides,
  });

/** Publica `AuctionOpened` y espera a que esté proyectada. */
async function newAuction(closesAt: string): Promise<string> {
  const auctionId = randomUUID();
  await new PrismaOutbox(db.prisma).enqueue(
    [
      buildEvent('AuctionOpened', TENANT, {
        auctionId,
        title: 'Subasta',
        opensAt: '2026-11-14T10:00:00.000Z',
        closesAt,
      }),
    ],
    events.name,
  );
  await waitFor(async () => (await db.prisma.auction.count({ where: { id: auctionId } })) === 1, {
    description: 'la subasta está proyectada',
  });
  return auctionId;
}

/** Publica `LotPublished` y espera a que lo conozcan el decisor y la proyección. */
async function newLot(closesAt: string, auctionId: string = randomUUID()): Promise<string> {
  const lotId = randomUUID();
  await new PrismaOutbox(db.prisma).enqueue(
    [
      buildEvent('LotPublished', TENANT, {
        lotId,
        auctionId,
        title: 'Lote',
        startingPrice: '100.00',
        minIncrement: '5.00',
        currency: 'USD',
        closesAt,
      }),
    ],
    events.name,
  );
  await waitFor(
    async () =>
      (await db.prisma.lotDecision.count({ where: { lotId } })) === 1 &&
      (await db.prisma.lot.count({ where: { id: lotId } })) === 1,
    { description: 'el lote es conocido por el decisor y la proyección' },
  );
  return lotId;
}

const bid = (lotId: string, bidderId: string, amount: string) =>
  app.inject({
    method: 'POST',
    url: `/v1/lots/${lotId}/bids`,
    headers: { 'x-bidder-id': bidderId, 'idempotency-key': `clave-${randomUUID()}` },
    payload: { amount },
  });

/** Eventos de decisión del lote, en el orden en que el decisor los escribió. */
async function history(lotId: string): Promise<DomainEvent[]> {
  const rows = await db.prisma.outboxMessage.findMany({
    where: { topic: events.name, key: lotId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.flatMap((row) => {
    const parsed = parseEvent(row.payload);
    return parsed.success && parsed.event.type !== 'LotPublished' ? [parsed.event] : [];
  });
}

const closedEvents = async (lotId: string) =>
  (await history(lotId)).filter((e) => e.type === 'LotClosed');

const waitForClosed = (lotId: string) =>
  waitFor(async () => (await closedEvents(lotId)).length >= 1, {
    description: 'el lote se cierra',
    timeoutMs: 60_000,
  });

const waitForProjectedClosed = (lotId: string) =>
  waitFor(
    async () => (await db.prisma.lot.findUnique({ where: { id: lotId } }))?.status === 'CLOSED',
    {
      description: 'la proyección refleja el cierre',
      timeoutMs: 60_000,
    },
  );

describe('cierre de lotes', () => {
  it('lote vencido con pujas: LotClosed con el mejor postor y el monto final', async () => {
    const lotId = await newLot('2026-11-14T12:30:00.000Z');
    await bid(lotId, bidders[0] ?? '', '100.00');
    await bid(lotId, bidders[1] ?? '', '120.00');
    await bid(lotId, bidders[2] ?? '', '110.00'); // rechazada: no supera 120 + 5
    await waitFor(async () => (await history(lotId)).length >= 3, { description: '3 decisiones' });

    const round = await closer(at('12:31:00')).runOnce();
    expect(round.lotsSignalled).toBeGreaterThanOrEqual(1);
    await waitForClosed(lotId);
    expect((await closedEvents(lotId))[0]).toMatchObject({
      type: 'LotClosed',
      payload: { lotId, winnerId: bidders[1], finalAmount: '120.00' },
    });
    await waitForProjectedClosed(lotId);
    const lot = await db.prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
    expect(lot.winnerId).toBe(bidders[1]);
    expect(await db.prisma.bid.count({ where: { lotId, awarded: true } })).toBe(1);
  });

  it('lote vencido sin pujas: se cierra desierto (winnerId y finalAmount nulos)', async () => {
    const lotId = await newLot('2026-11-14T12:30:00.000Z');
    await closer(at('12:31:00')).runOnce();
    await waitForClosed(lotId);
    expect((await closedEvents(lotId))[0]).toMatchObject({
      payload: { winnerId: null, finalAmount: null },
    });
  });

  it('antes de closesAt el closer no emite señal', async () => {
    const lotId = await newLot('2026-11-14T13:00:00.000Z');
    await closer(at('12:59:00')).runOnce();
    await new Promise((r) => setTimeout(r, 800));
    expect(
      await db.prisma.outboxMessage.count({ where: { topic: commands.name, key: lotId } }),
    ).toBe(0);
    expect(await closedEvents(lotId)).toHaveLength(0);
  });

  it('la señal repetida no duplica el cierre (ni el comando ni el LotClosed)', async () => {
    const lotId = await newLot('2026-11-14T12:30:00.000Z');
    await bid(lotId, bidders[0] ?? '', '100.00');
    await waitFor(async () => (await history(lotId)).length >= 1, { description: 'puja decidida' });
    const c = closer(at('12:31:00'));
    await Promise.all([c.runOnce(), c.runOnce()].map((p) => p.catch(() => undefined)));
    await c.runOnce();
    await waitForClosed(lotId);
    for (let i = 0; i < 3; i++) await c.runOnce(); // incluso con el lote ya cerrado en el decisor
    await new Promise((r) => setTimeout(r, 1_000));
    expect(await closedEvents(lotId)).toHaveLength(1);
    expect(
      await db.prisma.outboxMessage.count({ where: { topic: commands.name, key: lotId } }),
    ).toBe(2); // PlaceBid + 1 CloseLot
  });
});

describe('puja y cierre por la misma partición', () => {
  it('una puja a closesAt - 1 s y la señal de cierre a la vez: o cuenta (y extiende) o se rechaza, nunca hay un ganador distinto', async () => {
    const closesAt = '2026-11-14T12:30:00.000Z';
    const lots = await Promise.all(Array.from({ length: 12 }, () => newLot(closesAt)));
    // la puja (recibida 1 s antes del cierre) y la señal de cierre (1 s después) entran a la vez
    await Promise.all(
      lots.flatMap((lotId, i) => [
        new PrismaOutbox(db.prisma).enqueueCommand(
          buildCommand(
            'PlaceBid',
            TENANT,
            { lotId, bidderId: bidders[i % 4] ?? '', amount: '100.00' },
            { deps: { newId: () => newId(), now: () => at('12:29:59') } },
          ),
          commands.name,
        ),
        new PrismaOutbox(db.prisma).enqueueCommand(
          buildCommand(
            'CloseLot',
            TENANT,
            { lotId },
            { deps: { newId: () => newId(), now: () => at('12:30:01') } },
          ),
          commands.name,
        ),
      ]),
    );
    // Si la puja entró primero, el anti-sniping extendió el cierre y la señal de las 12:30:01 se
    // adelantó (no cierra); si el cierre entró primero, la puja se rechaza. En ambos casos una señal
    // posterior (12:32) acaba cerrando el lote.
    await Promise.all(
      lots.map((lotId) =>
        new PrismaOutbox(db.prisma).enqueueCommand(
          buildCommand(
            'CloseLot',
            TENANT,
            { lotId },
            { deps: { newId, now: () => at('12:32:00') } },
          ),
          commands.name,
        ),
      ),
    );
    for (const lotId of lots) await waitForClosed(lotId);

    let counted = 0;
    let rejected = 0;
    for (const [i, lotId] of lots.entries()) {
      const events = await history(lotId);
      const closeIndex = events.findIndex((e) => e.type === 'LotClosed');
      const placed = events.slice(0, closeIndex).filter((e) => e.type === 'BidPlaced');
      const closed = events[closeIndex];
      if (placed.length === 1) {
        counted += 1;
        expect(closed).toMatchObject({
          payload: { winnerId: bidders[i % 4], finalAmount: '100.00' },
        });
      } else {
        rejected += 1;
        expect(closed).toMatchObject({ payload: { winnerId: null, finalAmount: null } });
        expect(events.some((e) => e.type === 'BidRejected')).toBe(true);
      }
      // ninguna puja aceptada después del cierre
      expect(events.slice(closeIndex + 1).some((e) => e.type === 'BidPlaced')).toBe(false);
      expect(events.filter((e) => e.type === 'LotClosed')).toHaveLength(1);
    }
    expect(counted + rejected).toBe(12);
  }, 120_000);

  it('anti-sniping: una señal que se adelanta a la extensión no cierra el lote', async () => {
    const lotId = await newLot('2026-11-14T12:00:30.000Z'); // 30 s < 60 s de ventana
    await bid(lotId, bidders[0] ?? '', '100.00');
    await waitFor(async () => (await history(lotId)).length >= 2, {
      description: 'BidPlaced + LotExtended',
    });
    expect((await history(lotId)).map((e) => e.type)).toEqual(['BidPlaced', 'LotExtended']);

    // la señal sale a las 12:00:45 con el cierre original, pero el estado ya lo extendió a las 12:01:30
    await new PrismaOutbox(db.prisma).enqueueCommand(
      buildCommand(
        'CloseLot',
        TENANT,
        { lotId },
        { deps: { newId: () => newId(), now: () => at('12:00:45') } },
      ),
      commands.name,
    );
    await new Promise((r) => setTimeout(r, 1_500));
    expect(await closedEvents(lotId)).toHaveLength(0);
    expect((await db.prisma.lotDecision.findUniqueOrThrow({ where: { lotId } })).status).toBe(
      'OPEN',
    );

    // y pasado el nuevo cierre, sí
    await new PrismaOutbox(db.prisma).enqueueCommand(
      buildCommand(
        'CloseLot',
        TENANT,
        { lotId },
        { deps: { newId: () => newId(), now: () => at('12:02:00') } },
      ),
      commands.name,
    );
    await waitForClosed(lotId);
    expect((await closedEvents(lotId))[0]).toMatchObject({ payload: { winnerId: bidders[0] } });
  }, 60_000);
});

describe('cierre de subastas', () => {
  it('cuando se cierra el último lote y vence la subasta, AuctionClosed una sola vez', async () => {
    const auctionId = await newAuction('2026-11-14T12:40:00.000Z');
    const lots = [
      await newLot('2026-11-14T12:30:00.000Z', auctionId),
      await newLot('2026-11-14T12:30:00.000Z', auctionId),
    ];

    // aún quedan lotes abiertos: no se cierra la subasta
    const before = await closer(at('12:41:00')).runOnce();
    expect(before.auctionsClosed).toBe(0);

    for (const lotId of lots) await waitForClosed(lotId);
    for (const lotId of lots) await waitForProjectedClosed(lotId);

    // antes de que venza la subasta tampoco
    expect((await closer(at('12:35:00')).runOnce()).auctionsClosed).toBe(0);

    const c = closer(at('12:41:00'));
    expect((await c.runOnce()).auctionsClosed).toBe(1);
    await waitFor(
      async () =>
        (await db.prisma.auction.findUnique({ where: { id: auctionId } }))?.status === 'CLOSED',
      { description: 'la subasta se cierra en la proyección', timeoutMs: 60_000 },
    );
    for (let i = 0; i < 3; i++) await c.runOnce();
    const rows = await db.prisma.outboxMessage.findMany({
      where: { topic: events.name, key: auctionId },
    });
    expect(
      rows.filter((r) => (r.payload as { type: string }).type === 'AuctionClosed'),
    ).toHaveLength(1);
  }, 120_000);

  it('una subasta sin lotes se cierra al vencer', async () => {
    const auctionId = await newAuction('2026-11-14T12:50:00.000Z');
    expect((await closer(at('12:49:00')).runOnce()).auctionsClosed).toBe(0);
    expect((await closer(at('12:51:00')).runOnce()).auctionsClosed).toBeGreaterThanOrEqual(1);
    await waitFor(
      async () =>
        (await db.prisma.auction.findUnique({ where: { id: auctionId } }))?.status === 'CLOSED',
      { description: 'la subasta se cierra', timeoutMs: 60_000 },
    );
  });
});

/** ¿Hay alguien sosteniendo el bloqueo del closer? Si estaba libre, lo suelta de inmediato. */
async function lockHeld(): Promise<boolean> {
  const probe = await tryAcquireLeadership(db.url, CLOSER_LOCK_KEY);
  if (probe === null) return true;
  await probe.release();
  return false;
}

describe('liderazgo y mantenimiento', () => {
  it('solo un closer a la vez es líder y otro toma el relevo al detenerse', async () => {
    const options = {
      prisma: db.prisma,
      databaseUrl: db.url,
      commandsTopic: commands.name,
      eventsTopic: events.name,
      pollIntervalMs: 50,
      standbyPollMs: 50,
    };
    const a = new Closer(options);
    const b = new Closer(options);
    void a.start();
    await waitFor(lockHeld, { description: 'A es líder' });
    void b.start();
    await new Promise((r) => setTimeout(r, 300));
    expect(await lockHeld()).toBe(true); // sigue habiendo un único líder
    await a.stop();
    // B relevó a A: el bloqueo vuelve a estar tomado
    await waitFor(lockHeld, { description: 'B toma el relevo' });
    await b.stop();
    expect(await lockHeld()).toBe(false); // y al detenerse el último, el bloqueo queda libre
  }, 60_000);

  it('borra las claves de idempotencia caducadas, y solo cada cleanupEveryMs', async () => {
    const old = {
      tenantId: TENANT,
      bidderId: randomUUID(),
      key: `vieja-${randomUUID()}`,
      requestHash: 'x',
      commandId: randomUUID(),
      lotId: randomUUID(),
      createdAt: new Date(Date.now() - 48 * 3_600_000),
    };
    await db.prisma.idempotencyKey.create({ data: old });
    const c = closer(new Date(), { cleanupEveryMs: 3_600_000 });
    expect((await c.runOnce()).keysDeleted).toBeGreaterThanOrEqual(1);
    expect(await db.prisma.idempotencyKey.count({ where: { bidderId: old.bidderId } })).toBe(0);
    expect((await c.runOnce()).keysDeleted).toBe(0); // la limpieza no se repite en cada ronda
  });
});

describe('reproceso', () => {
  it('lot_decision reconstruido desde el log (con cierres incluidos) == el estado en vivo', async () => {
    const snapshot = async () =>
      JSON.stringify(await db.prisma.lotDecision.findMany({ orderBy: { lotId: 'asc' } }));
    const live = await snapshot();
    expect((JSON.parse(live) as { status: string }[]).some((l) => l.status === 'CLOSED')).toBe(
      true,
    );

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
