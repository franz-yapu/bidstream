import {
  buildApp,
  HeaderTenantResolver,
  loadConfig as loadApiConfig,
  SystemClock,
  Uuid7Generator,
} from '@bidstream/api';
import { createNotifier } from '@bidstream/notifier-app';
import { createProjector } from '@bidstream/projector';
import { OutboxRelay } from '@bidstream/relay';
import type { EventConsumer, ProcessOutcome } from '@bidstream/consumer';
import { PrismaOutbox } from '@bidstream/db';
import { buildEvent, foldLot, formatMoney, parseEvent, type DomainEvent } from '@bidstream/domain';
import { createProducer, type KafkaProducer } from '@bidstream/kafka';
import {
  InMemoryNotificationBus,
  startNotificationListener,
  type RunningNotificationListener,
} from '@bidstream/notifier';
import {
  createTestDatabase,
  createTestTopic,
  testKafkaConfig,
  waitFor,
  type TestDatabase,
  type TestTopic,
} from '@bidstream/testing';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { buildYoga } from './server.js';

// EL FLUJO COMPLETO, todo real: API REST → outbox → relay → Kafka → projector y notifier →
// PostgreSQL (proyección y NOTIFY) → GraphQL (consulta y subscription por SSE).
const kafka = testKafkaConfig();
const TENANT = '11111111-1111-4111-8111-111111111111';
const ANA = '44444444-4444-4444-8444-444444444444';
const BEN = '55555555-5555-4555-8555-555555555555';

let db: TestDatabase;
let events: TestTopic;
let dlq: TestTopic;
let producer: KafkaProducer;
let api: FastifyInstance;
let relay: OutboxRelay;
let projector: EventConsumer;
let notifier: EventConsumer;
let listener: RunningNotificationListener;
let bus: InMemoryNotificationBus;
let yoga: ReturnType<typeof buildYoga>;
const projectorOutcomes: ProcessOutcome[] = [];
const notifierOutcomes: ProcessOutcome[] = [];
const sseClients: { close(): void }[] = [];

beforeAll(async () => {
  db = await createTestDatabase();
  [events, dlq] = await Promise.all([createTestTopic({ partitions: 3 }), createTestTopic()]);
  producer = await createProducer(kafka, { eventsTopic: events.name });

  api = buildApp({
    config: loadApiConfig({
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://u:p@x/d',
    }),
    prisma: db.prisma,
    clock: new SystemClock(),
    ids: new Uuid7Generator(),
    tenantResolver: new HeaderTenantResolver(),
    eventsTopic: events.name,
    commandsTopic: 'bidstream.commands.bid',
  });
  relay = new OutboxRelay({
    prisma: db.prisma,
    publish: (r) => producer.publish(r.topic, { key: r.key, value: r.value, headers: r.headers }),
  });
  const common = {
    kafka,
    prisma: db.prisma,
    topics: [events.name],
    dlqTopic: dlq.name,
    retry: { baseDelayMs: 1, capMs: 2 },
  };
  projector = await createProjector({
    ...common,
    groupId: `projector-flow-${randomUUID()}`,
    onOutcome: (o) => projectorOutcomes.push(o),
  });
  notifier = await createNotifier({
    ...common,
    groupId: `notifier-flow-${randomUUID()}`,
    onOutcome: (o) => notifierOutcomes.push(o),
  });
  void projector.run();
  void notifier.run();

  bus = new InMemoryNotificationBus();
  listener = startNotificationListener({ connectionString: db.url, bus });
  await listener.ready;
  yoga = buildYoga({
    config: loadConfig({
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://u:p@x/d',
    }),
    db: db.prisma,
    bus,
  });
});
afterAll(async () => {
  for (const c of sseClients) c.close();
  await Promise.all([projector.disconnect(), notifier.disconnect()]);
  await listener.stop();
  await api.close();
  await producer.disconnect();
  await Promise.all([events.drop(), dlq.drop()]);
  await db.drop();
});

const headers = { 'x-tenant-id': TENANT };

async function gql<T>(query: string, variables?: object): Promise<T> {
  const response = await yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors !== undefined) throw new Error(`GraphQL: ${body.errors[0]?.message ?? '?'}`);
  return body.data as T;
}

/** Cliente SSE mínimo: consume el flujo en segundo plano y devuelve los eventos `next` en orden. */
async function openSubscription(
  lotId: string,
): Promise<{ next(): Promise<Record<string, unknown>> }> {
  const response = await yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream, application/graphql-response+json',
      ...headers,
    },
    body: JSON.stringify({
      query: `subscription($id: ID!) { lotUpdated(lotId: $id) {
        __typename
        ... on BidPlacedUpdate { amount }
        ... on LotClosedUpdate { finalAmount hasWinner }
        ... on LotExtendedUpdate { newClosesAt }
      } }`,
      variables: { id: lotId },
    }),
  });
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const queue: Record<string, unknown>[] = [];
  void (async () => {
    let buffer = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return;
        buffer += decoder.decode(chunk.value, { stream: true });
        for (let at = buffer.indexOf('\n\n'); at >= 0; at = buffer.indexOf('\n\n')) {
          const raw = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          const lines = raw.split('\n').filter((l) => !l.startsWith(':'));
          const data = lines
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .join('');
          if (lines.some((l) => l.startsWith('event: next')) && data !== '') {
            const parsed = JSON.parse(data) as { data?: { lotUpdated?: Record<string, unknown> } };
            if (parsed.data?.lotUpdated !== undefined) queue.push(parsed.data.lotUpdated);
          }
        }
      }
    } catch {
      // flujo cancelado
    }
  })();
  sseClients.push({
    close: () => {
      void reader.cancel().catch(() => undefined);
    },
  });
  return {
    next: async () => {
      await waitFor(() => queue.length > 0, {
        timeoutMs: 15_000,
        description: 'un evento de la subscription',
      });
      return queue.shift() ?? {};
    },
  };
}

const waitUntilNonNull = (query: string, field: string, variables: object): Promise<void> =>
  waitFor(async () => (await gql<Record<string, unknown>>(query, variables))[field] !== null, {
    timeoutMs: 20_000,
    description: `${field} proyectado`,
  });

describe('el flujo completo, de punta a punta', () => {
  it('API → relay → Kafka → projector y notifier → GraphQL: consulta y subscription coinciden con el dominio', async () => {
    // 1. La API acepta el comando; el evento viaja por outbox, relay y Kafka hasta la proyección.
    const auctionRes = await api.inject({
      method: 'POST',
      url: '/v1/auctions',
      headers,
      payload: {
        title: 'Subasta de relojes',
        opensAt: '2031-01-01T10:00:00.000Z',
        closesAt: '2031-01-02T10:00:00.000Z',
      },
    });
    expect(auctionRes.statusCode).toBe(201);
    const { auctionId } = auctionRes.json<{ auctionId: string }>();
    expect((await relay.runOnce()).published).toBe(1);
    await waitUntilNonNull(`query($id: ID!) { auction(id: $id) { id } }`, 'auction', {
      id: auctionId,
    });

    // 2. La subasta ya está en la proyección, así que la API acepta el lote.
    const lotRes = await api.inject({
      method: 'POST',
      url: `/v1/auctions/${auctionId}/lots`,
      headers,
      payload: {
        title: 'Reloj de bolsillo',
        startingPrice: '250.00',
        minIncrement: '10.00',
        currency: 'EUR',
        closesAt: '2031-01-02T09:00:00.000Z',
      },
    });
    expect(lotRes.statusCode).toBe(201);
    const { lotId } = lotRes.json<{ lotId: string }>();
    await relay.runOnce();
    await waitUntilNonNull(`query($id: ID!) { lot(id: $id) { id } }`, 'lot', { id: lotId });

    // GraphQL ya ve el lote, con la regla del dominio aplicada.
    const created = await gql<{ lot: Record<string, unknown> }>(
      `query($id: ID!) { lot(id: $id) { title startingPrice currency status currentPrice nextMinimumBid auction { title } } }`,
      { id: lotId },
    );
    expect(created.lot).toEqual({
      title: 'Reloj de bolsillo',
      startingPrice: '250.00',
      currency: 'EUR',
      status: 'OPEN',
      currentPrice: null,
      nextMinimumBid: '250.00',
      auction: { title: 'Subasta de relojes' },
    });

    // 3. Antes de suscribirse, el notifier debe haber procesado los dos eventos ya publicados
    //    (si no, su aviso llegaría a la subscription como si fuera nuevo).
    await waitFor(() => notifierOutcomes.length === 2, { description: 'notifier al día' });

    // 4. Un cliente abre la subscription por SSE.
    const subscription = await openSubscription(lotId);
    await waitFor(() => bus.subscriptionCount() === 1, { description: 'subscription activa' });

    // 5. Dos pujas y el cierre (la API de pujas es C3): se escriben en el outbox como lo haría ella.
    const t = '2031-01-01T11:00:00.000Z';
    await new PrismaOutbox(db.prisma).enqueue(
      [
        buildEvent('BidPlaced', TENANT, { lotId, bidderId: ANA, amount: '250.00', placedAt: t }),
        buildEvent('BidPlaced', TENANT, { lotId, bidderId: BEN, amount: '300.00', placedAt: t }),
        buildEvent('LotClosed', TENANT, { lotId, winnerId: BEN, finalAmount: '300.00' }),
      ],
      events.name,
    );
    expect((await relay.runOnce()).published).toBe(3);

    // 6. La subscription recibe las tres actualizaciones, en orden y sin identidades.
    const received = [
      await subscription.next(),
      await subscription.next(),
      await subscription.next(),
    ];
    expect(received).toEqual([
      { __typename: 'BidPlacedUpdate', amount: '250.00' },
      { __typename: 'BidPlacedUpdate', amount: '300.00' },
      { __typename: 'LotClosedUpdate', finalAmount: '300.00', hasWinner: true },
    ]);
    expect(JSON.stringify(received)).not.toMatch(/bidderId|winnerId|44444444|55555555/);

    // 7. La consulta refleja el estado final.
    await waitFor(
      async () =>
        (
          await gql<{ lot: { status: string } }>(`query($id: ID!) { lot(id: $id) { status } }`, {
            id: lotId,
          })
        ).lot.status === 'CLOSED',
      { timeoutMs: 20_000, description: 'lote cerrado en la proyección' },
    );
    const final = await gql<{ lot: Record<string, unknown> }>(
      `query($id: ID!) { lot(id: $id) { status currentPrice hasWinner finalAmount nextMinimumBid
         bids(first: 5) { edges { node { amount rank awarded } } } } }`,
      { id: lotId },
    );
    expect(final.lot).toMatchObject({
      status: 'CLOSED',
      currentPrice: '300.00',
      hasWinner: true,
      finalAmount: '300.00',
    });
    expect((final.lot['bids'] as { edges: { node: unknown }[] }).edges.map((e) => e.node)).toEqual([
      { amount: '300.00', rank: 1, awarded: true },
      { amount: '250.00', rank: 2, awarded: false },
    ]);

    // 8. Ese estado es exactamente el que calcula el dominio a partir del historial del outbox.
    const rows = await db.prisma.outboxMessage.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const history: DomainEvent[] = rows.map((row) => {
      const parsed = parseEvent(row.payload);
      if (!parsed.success) throw new Error('el outbox contiene un evento inválido');
      return parsed.event;
    });
    expect(history.map((e) => e.type)).toEqual([
      'AuctionOpened',
      'LotPublished',
      'BidPlaced',
      'BidPlaced',
      'LotClosed',
    ]);
    const expected = foldLot(
      history.filter((e) => 'lotId' in e.payload && e.payload.lotId === lotId),
    );
    expect(expected).toMatchObject({ status: 'closed', winnerId: BEN });
    expect(formatMoney(expected?.currentPrice ?? 0n)).toBe('300.00');

    // 9. Ningún evento acabó en el DLQ: todo se procesó.
    await waitFor(() => projectorOutcomes.length === 5 && notifierOutcomes.length === 5, {
      description: 'los dos consumidores terminan',
    });
    expect(projectorOutcomes.every((o) => o.kind === 'processed')).toBe(true);
    expect(notifierOutcomes.every((o) => o.kind === 'processed')).toBe(true);
  });
});
