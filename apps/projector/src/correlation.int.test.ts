import { buildApp, HeaderTenantResolver, loadConfig, Uuid7Generator } from '@bidstream/api';
import { PrismaOutbox } from '@bidstream/db';
import { buildEvent, FixedClock } from '@bidstream/domain';
import { createProducer, type KafkaProducer } from '@bidstream/kafka';
import { createLogger } from '@bidstream/logging';
import { OutboxRelay } from '@bidstream/relay';
import {
  collectMessages,
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

// F4: el id de correlación viaja de la petición HTTP al log de los consumidores, y los logs no
// filtran secretos ni identidades (OWASP A09).
const kafka = testKafkaConfig();
const TENANT = '11111111-1111-4111-8111-111111111111';
const BIDDER = '99999999-9999-4999-8999-999999999999';
const SECRET_URL = 'postgresql://app:ClaveSecreta123@db.interna:5432/x';
const NOW = new Date('2026-11-12T20:00:00.000Z');

let db: TestDatabase;
let events: TestTopic;
let dlq: TestTopic;
let producer: KafkaProducer;
let projector: EventConsumer;
let app: FastifyInstance;
let relay: OutboxRelay;
const relayLines: string[] = [];
const projectorLines: string[] = [];
const apiLines: string[] = [];
const outcomes: ProcessOutcome[] = [];

const parse = (lines: string[]): Record<string, unknown>[] =>
  lines.map((l) => JSON.parse(l) as Record<string, unknown>);

beforeAll(async () => {
  db = await createTestDatabase();
  [events, dlq] = await Promise.all([createTestTopic({ partitions: 2 }), createTestTopic()]);
  producer = await createProducer(kafka);
  app = buildApp({
    config: loadConfig({
      LOG_LEVEL: 'info',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
    }),
    prisma: db.prisma,
    clock: new FixedClock(NOW),
    ids: new Uuid7Generator(),
    tenantResolver: new HeaderTenantResolver(),
    eventsTopic: events.name,
    commandsTopic: 'bidstream.commands.bid',
    logStream: { write: (chunk) => void apiLines.push(chunk) },
  });
  relay = new OutboxRelay({
    prisma: db.prisma,
    publish: (r) => producer.publish(r.topic, { key: r.key, value: r.value, headers: r.headers }),
    logger: createLogger({ service: 'relay', write: (l) => relayLines.push(l) }),
  });
  projector = await createProjector({
    kafka,
    prisma: db.prisma,
    topics: [events.name],
    dlqTopic: dlq.name,
    retry: { baseDelayMs: 1, capMs: 2 },
    logger: createLogger({ service: 'projector', write: (l) => projectorLines.push(l) }),
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

async function relayAndWait(expected: number): Promise<void> {
  const target = outcomes.length + expected;
  expect((await relay.runOnce()).published).toBe(expected);
  await waitFor(() => outcomes.length >= target, { description: `${String(expected)} procesados` });
}

describe('propagación del id de correlación', () => {
  it('petición → outbox → cabecera Kafka → log del relay y del consumidor, con el mismo id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auctions',
      headers: { 'x-tenant-id': TENANT, 'x-request-id': 'req-abc.123' },
      payload: {
        title: 'Correlada',
        opensAt: '2026-11-13T10:00:00.000Z',
        closesAt: '2026-11-13T20:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers['x-request-id']).toBe('req-abc.123');
    const { auctionId } = res.json<{ auctionId: string }>();

    const row = await db.prisma.outboxMessage.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    expect((row.payload as { meta?: unknown }).meta).toEqual({ correlationId: 'req-abc.123' });

    await relayAndWait(1);

    const published = parse(relayLines).find((l) => l['msg'] === 'evento publicado');
    expect(published).toMatchObject({
      service: 'relay',
      correlationId: 'req-abc.123',
      type: 'AuctionOpened',
    });
    const processed = parse(projectorLines).find((l) => l['msg'] === 'evento procesado');
    expect(processed).toMatchObject({
      service: 'projector',
      correlationId: 'req-abc.123',
      eventId: published?.['eventId'],
    });
    // los logs de la API del mismo requestId (pino: `reqId`) se pueden unir por el mismo valor
    expect(apiLines.some((l) => l.includes('"reqId":"req-abc.123"'))).toBe(true);
    expect(auctionId).toBeTruthy();
  });

  it('sin x-request-id válido se genera uno, se devuelve y coincide con el del evento', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auctions',
      headers: { 'x-tenant-id': TENANT, 'x-request-id': 'inválido\nINYECCIÓN {"level":"error"}' },
      payload: {
        title: 'Sin id',
        opensAt: '2026-11-13T10:00:00.000Z',
        closesAt: '2026-11-13T20:00:00.000Z',
      },
    });
    const id = String(res.headers['x-request-id']);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const row = await db.prisma.outboxMessage.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    expect((row.payload as { meta?: { correlationId?: string } }).meta?.correlationId).toBe(id);
    await relayAndWait(1);
  });
});

describe('diagnóstico y fugas', () => {
  it('un evento que acaba en el DLQ conserva el id de correlación en el mensaje y en el log', async () => {
    // BidPlaced de un lote inexistente: la proyección lanza y se agotan los reintentos.
    const orphan = buildEvent(
      'BidPlaced',
      TENANT,
      {
        lotId: crypto.randomUUID(),
        bidderId: BIDDER,
        amount: '100.00',
        placedAt: '2026-11-13T17:00:00.000Z',
      },
      { meta: { correlationId: 'req-dlq-1' } },
    );
    await new PrismaOutbox(db.prisma).enqueue([orphan], events.name);
    await relayAndWait(1);

    const [message] = await collectMessages({ topic: dlq.name, count: 1 });
    expect(message?.headers['correlationId']).toBe('req-dlq-1');
    expect(JSON.parse(message?.value ?? '{}')).toMatchObject({ correlationId: 'req-dlq-1' });
    const logged = parse(projectorLines).find((l) => l['msg'] === 'evento apartado al DLQ');
    expect(logged).toMatchObject({ correlationId: 'req-dlq-1', eventId: orphan.eventId });
  });

  it('ningún log de la cadena contiene identidades, secretos ni cargas útiles', () => {
    const logger = createLogger({ service: 'prueba', write: (l) => projectorLines.push(l) });
    logger.error(
      { err: new Error(`no conecta a ${SECRET_URL}`), password: 'p', 'x-admin-key': 'k' },
      'x',
    );
    const all = [...relayLines, ...projectorLines, ...apiLines].join('\n');
    expect(all).not.toContain(BIDDER);
    expect(all).not.toContain('ClaveSecreta123');
    expect(all).not.toContain('postgresql://u:p@');
    expect(all).not.toContain('"amount"');
    expect(all).toContain('[REDACTED]');
  });
});
