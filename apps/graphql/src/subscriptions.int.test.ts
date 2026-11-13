import { randomUUID } from 'node:crypto';
import { applyEventToProjection, createPrismaClient } from '@bidstream/db';
import { buildEvent, type DomainEvent } from '@bidstream/domain';
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
  generateHistory,
  waitFor,
  type TestDatabase,
} from '@bidstream/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { buildHttpServer, buildYoga } from './server.js';

// La subscription `lotUpdated` por SSE contra PostgreSQL real: el flujo es el de producción
// (publishNotification → NOTIFY → oyente → bus → subscription), sin Kafka en medio.
const env = {
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
};
const history = generateHistory({ seed: 42, auctions: 1, lotsPerAuction: 2, bidsPerLot: 4 });
const TENANT = history[0]?.tenantId ?? '';
const OTHER = '99999999-9999-4999-8999-999999999999';
const lotIds = history.filter((e) => e.type === 'LotPublished').map((e) => e.payload.lotId);

let db: TestDatabase;
let prisma: ReturnType<typeof createPrismaClient>;
let bus: InMemoryNotificationBus;
let listener: RunningNotificationListener;
const clients: { close(): void }[] = [];

beforeAll(async () => {
  db = await createTestDatabase();
  prisma = createPrismaClient(db.url);
  for (const e of history) await prisma.$transaction((tx) => applyEventToProjection(tx, e));
  bus = new InMemoryNotificationBus();
  listener = startNotificationListener({
    connectionString: db.url,
    bus,
    backoff: { baseMs: 20, capMs: 100 },
  });
  await listener.ready;
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await waitFor(() => bus.subscriptionCount() === 0, {
    description: 'sin suscripciones tras el cierre',
  });
});
afterAll(async () => {
  await listener.stop();
  await prisma.$disconnect();
  await db.drop();
});

type Yoga = ReturnType<typeof buildYoga>;
const server = (overrides: Record<string, string> = {}): Yoga =>
  buildYoga({ config: loadConfig({ ...env, ...overrides }), db: prisma, bus });

const QUERY = `subscription($id: ID!) { lotUpdated(lotId: $id) {
  __typename
  ... on LotPublishedUpdate { eventId lotId auctionId startingPrice closesAt }
  ... on BidPlacedUpdate { eventId occurredAt lotId amount placedAt }
  ... on LotExtendedUpdate { lotId newClosesAt }
  ... on LotClosedUpdate { lotId finalAmount hasWinner }
  ... on ResyncRequired { message }
} }`;

interface Event {
  data?: { lotUpdated?: Record<string, unknown> } | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}

interface Client {
  readonly status: number;
  /** Siguiente evento `next` del flujo (o el cuerpo JSON si no hubo flujo); `null` al terminar. */
  next(): Promise<Event | null>;
  close(): void;
}

/** Cliente SSE mínimo: lee `text/event-stream` de GraphQL sobre SSE y devuelve los eventos `next`. */
async function subscribe(
  yoga: Yoga,
  lotId: string,
  options: { tenant?: string | null; query?: string } = {},
): Promise<Client> {
  const controller = new AbortController();
  const tenant = options.tenant === undefined ? TENANT : options.tenant;
  const response = await yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream, application/graphql-response+json',
      ...(tenant === null ? {} : { 'x-tenant-id': tenant }),
    },
    body: JSON.stringify({ query: options.query ?? QUERY, variables: { id: lotId } }),
  });

  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const body = (await response.json()) as Event;
    let served = false;
    const jsonClient: Client = {
      status: response.status,
      next: () => {
        if (served) return Promise.resolve(null);
        served = true;
        return Promise.resolve(body);
      },
      close: () => {
        controller.abort();
      },
    };
    clients.push(jsonClient);
    return jsonClient;
  }

  // Un cliente real lee el flujo de forma continua (Yoga solo arranca la suscripción al empezar a
  // leer): una tarea en segundo plano consume el flujo y encola los eventos `next`.
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const queue: (Event | null)[] = [];
  let wake: (() => void) | undefined;
  const push = (item: Event | null): void => {
    queue.push(item);
    wake?.();
  };
  void (async () => {
    let buffer = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        for (
          let boundary = buffer.indexOf('\n\n');
          boundary >= 0;
          boundary = buffer.indexOf('\n\n')
        ) {
          const raw = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const lines = raw.split('\n').filter((l) => !l.startsWith(':'));
          const type = lines
            .find((l) => l.startsWith('event:'))
            ?.slice(6)
            .trim();
          const data = lines
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .join('');
          if (type === 'complete') {
            push(null);
            return;
          }
          if (type === 'next' && data !== '') push(JSON.parse(data) as Event);
        }
      }
    } catch {
      // la petición se canceló
    }
    push(null);
  })();

  const sseClient: Client = {
    status: response.status,
    // Cancelar el flujo es lo que ocurre cuando el cliente se desconecta; el `AbortSignal` de
    // `yoga.fetch` en proceso no se propaga al servidor, así que no basta por sí solo.
    close: () => {
      controller.abort();
      void reader.cancel().catch(() => undefined);
    },
    next: async () => {
      const deadline = Date.now() + 8_000;
      while (queue.length === 0) {
        if (Date.now() > deadline) throw new Error('timeout esperando un evento SSE');
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 100);
        });
      }
      return queue.shift() ?? null;
    },
  };
  clients.push(sseClient);
  return sseClient;
}

const publish = (n: LotNotification): Promise<void> =>
  db.prisma.$transaction((tx) => publishNotification(tx, n));
const ready = (n: number): Promise<void> =>
  waitFor(() => bus.subscriptionCount() === n, {
    description: `${String(n)} suscripción(es) activa(s)`,
  });

const notificationFor = (event: DomainEvent): LotNotification => {
  const n = toLotNotification(event);
  if (n === null) throw new Error('el evento debía generar notificación');
  return n;
};
const lotId = lotIds[0] ?? '';

describe('lotUpdated por SSE', () => {
  it('cada uno de los 4 tipos llega como su variante de la unión, con sus campos', async () => {
    const client = await subscribe(server(), lotId);
    await ready(1);
    const events: DomainEvent[] = [
      buildEvent('LotPublished', TENANT, {
        lotId,
        auctionId: randomUUID(),
        title: 'T',
        startingPrice: '10.00',
        minIncrement: '1.00',
        currency: 'USD',
        closesAt: '2030-01-02T00:00:00.000Z',
      }),
      buildEvent('BidPlaced', TENANT, {
        lotId,
        bidderId: '44444444-4444-4444-8444-444444444444',
        amount: '120.50',
        placedAt: '2030-01-01T10:00:00.000Z',
      }),
      buildEvent('LotExtended', TENANT, {
        lotId,
        newClosesAt: '2030-01-02T00:05:00.000Z',
        reason: 'anti-sniping',
      }),
      buildEvent('LotClosed', TENANT, {
        lotId,
        winnerId: '44444444-4444-4444-8444-444444444444',
        finalAmount: '120.50',
      }),
    ];
    for (const e of events) await publish(notificationFor(e));

    const got: Record<string, unknown>[] = [];
    for (let i = 0; i < 4; i++) {
      const event = await client.next();
      expect(event?.errors).toBeUndefined();
      got.push(event?.data?.lotUpdated ?? {});
    }
    expect(got.map((g) => g['__typename'])).toEqual([
      'LotPublishedUpdate',
      'BidPlacedUpdate',
      'LotExtendedUpdate',
      'LotClosedUpdate',
    ]);
    expect(got[0]).toMatchObject({
      lotId,
      startingPrice: '10.00',
      closesAt: '2030-01-02T00:00:00.000Z',
    });
    expect(got[1]).toMatchObject({ lotId, amount: '120.50', placedAt: '2030-01-01T10:00:00.000Z' });
    expect(got[2]).toMatchObject({ newClosesAt: '2030-01-02T00:05:00.000Z' });
    expect(got[3]).toMatchObject({ finalAmount: '120.50', hasWinner: true });
    expect(JSON.stringify(got)).not.toMatch(/bidderId|winnerId|44444444/);
  });

  it('las notificaciones de un mismo lote llegan en orden', async () => {
    const client = await subscribe(server(), lotId);
    await ready(1);
    const sent: string[] = [];
    for (let i = 0; i < 6; i++) {
      const n = notificationFor(
        buildEvent('BidPlaced', TENANT, {
          lotId,
          bidderId: '44444444-4444-4444-8444-444444444444',
          amount: `${String(100 + i)}.00`,
          placedAt: '2030-01-01T10:00:00.000Z',
        }),
      );
      sent.push(n.eventId);
      await publish(n);
    }
    const got: unknown[] = [];
    for (let i = 0; i < 6; i++) got.push((await client.next())?.data?.lotUpdated?.['eventId']);
    expect(got).toEqual(sent);
  });

  it('dos clientes del mismo lote reciben ambos; un cliente de otro tenant no puede suscribirse', async () => {
    const yoga = server();
    const a = await subscribe(yoga, lotId);
    const b = await subscribe(yoga, lotId);
    await ready(2);
    const foreign = await subscribe(yoga, lotId, { tenant: OTHER });
    expect((await foreign.next())?.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
    expect(bus.subscriptionCount()).toBe(2);

    const n = notificationFor(
      buildEvent('LotExtended', TENANT, {
        lotId,
        newClosesAt: '2030-01-02T00:05:00.000Z',
        reason: 'anti-sniping',
      }),
    );
    await publish(n);
    expect((await a.next())?.data?.lotUpdated?.['__typename']).toBe('LotExtendedUpdate');
    expect((await b.next())?.data?.lotUpdated?.['__typename']).toBe('LotExtendedUpdate');
  });

  it('no recibe las notificaciones de otro lote ni de otro tenant publicadas en el canal', async () => {
    const client = await subscribe(server(), lotId);
    await ready(1);
    await publish(
      notificationFor(
        buildEvent('LotExtended', TENANT, {
          lotId: lotIds[1] ?? '',
          newClosesAt: '2030-01-02T00:05:00.000Z',
          reason: 'anti-sniping',
        }),
      ),
    );
    await publish(
      notificationFor(
        buildEvent('LotExtended', OTHER, {
          lotId,
          newClosesAt: '2030-01-02T00:05:00.000Z',
          reason: 'anti-sniping',
        }),
      ),
    );
    const mine = notificationFor(
      buildEvent('LotExtended', TENANT, {
        lotId,
        newClosesAt: '2030-01-09T00:00:00.000Z',
        reason: 'anti-sniping',
      }),
    );
    await publish(mine);
    expect((await client.next())?.data?.lotUpdated).toMatchObject({
      newClosesAt: '2030-01-09T00:00:00.000Z',
    });
  });
});

describe('suscripciones inválidas', () => {
  it('un lote inexistente → NOT_FOUND y no se crea ninguna suscripción', async () => {
    const client = await subscribe(server(), randomUUID());
    expect((await client.next())?.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
    expect(bus.subscriptionCount()).toBe(0);
  });

  it('un id que no es UUID → BAD_USER_INPUT; sin tenant → UNAUTHENTICATED', async () => {
    const bad = await subscribe(server(), 'no-es-uuid');
    expect((await bad.next())?.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    const anonymous = await subscribe(server(), lotId, { tenant: null });
    expect(anonymous.status).toBe(401);
    expect((await anonymous.next())?.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    expect(bus.subscriptionCount()).toBe(0);
  });

  it('una subscription que supera los límites de E2 se rechaza sin suscribirse', async () => {
    const strict = server({ GQL_MAX_DEPTH: '1' });
    const client = await subscribe(strict, lotId);
    expect((await client.next())?.errors?.[0]?.extensions?.code).toBe('QUERY_TOO_DEEP');
    expect(bus.subscriptionCount()).toBe(0);
  });
});

describe('recursos', () => {
  it('al cancelar la petición se libera la suscripción del bus (sin fugas)', async () => {
    const client = await subscribe(server(), lotId);
    await ready(1);
    client.close();
    await waitFor(() => bus.subscriptionCount() === 0, { description: 'suscripción liberada' });
  });

  it('el cupo por tenant se respeta y se recupera al liberar', async () => {
    const yoga = server({ GQL_MAX_SUBSCRIPTIONS_PER_TENANT: '2' });
    const a = await subscribe(yoga, lotId);
    await subscribe(yoga, lotId);
    await ready(2);
    const third = await subscribe(yoga, lotId);
    expect((await third.next())?.errors?.[0]?.extensions?.code).toBe('TOO_MANY_SUBSCRIPTIONS');
    expect(bus.subscriptionCount()).toBe(2);

    a.close();
    await waitFor(() => bus.subscriptionCount() === 1, { description: 'una suscripción liberada' });
    const again = await subscribe(yoga, lotId);
    await ready(2);
    await publish(
      notificationFor(
        buildEvent('LotExtended', TENANT, {
          lotId,
          newClosesAt: '2030-01-02T00:05:00.000Z',
          reason: 'anti-sniping',
        }),
      ),
    );
    expect((await again.next())?.data?.lotUpdated?.['__typename']).toBe('LotExtendedUpdate');
  });

  it('el cupo de un tenant no afecta a otro', async () => {
    const yoga = server({ GQL_MAX_SUBSCRIPTIONS_PER_TENANT: '1' });
    await subscribe(yoga, lotId);
    await ready(1);
    // un tenant distinto con su propio lote sembrado
    const auctionId = randomUUID();
    const otherLot = randomUUID();
    for (const e of [
      buildEvent('AuctionOpened', OTHER, {
        auctionId,
        title: 'O',
        opensAt: '2030-01-01T00:00:00.000Z',
        closesAt: '2030-02-01T00:00:00.000Z',
      }),
      buildEvent('LotPublished', OTHER, {
        lotId: otherLot,
        auctionId,
        title: 'L',
        startingPrice: '1.00',
        minIncrement: '1.00',
        currency: 'USD',
        closesAt: '2030-02-01T00:00:00.000Z',
      }),
    ]) {
      await prisma.$transaction((tx) => applyEventToProjection(tx, e));
    }
    const other = await subscribe(yoga, otherLot, { tenant: OTHER });
    await ready(2);
    await publish(
      notificationFor(
        buildEvent('LotExtended', OTHER, {
          lotId: otherLot,
          newClosesAt: '2030-02-01T00:05:00.000Z',
          reason: 'anti-sniping',
        }),
      ),
    );
    expect((await other.next())?.data?.lotUpdated?.['__typename']).toBe('LotExtendedUpdate');
  });
});

describe('desconexión con un servidor HTTP real', () => {
  it('cuando el cliente se desconecta se libera la suscripción y el cupo', async () => {
    const httpServer = buildHttpServer({
      config: loadConfig({ ...env, GQL_MAX_SUBSCRIPTIONS_PER_TENANT: '1' }),
      db: prisma,
      bus,
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    try {
      const address = httpServer.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      const open = async (signal: AbortSignal): Promise<Response> =>
        fetch(`http://127.0.0.1:${String(port)}/graphql`, {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream, application/graphql-response+json',
            'x-tenant-id': TENANT,
          },
          body: JSON.stringify({ query: QUERY, variables: { id: lotId } }),
        });

      const first = new AbortController();
      const response = await open(first.signal);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      void response.body
        ?.getReader()
        .read()
        .catch(() => undefined);
      await ready(1);

      // con el cupo de 1 lleno, una segunda suscripción del mismo tenant se rechaza
      const second = await open(new AbortController().signal);
      expect(((await second.json()) as Event).errors?.[0]?.extensions?.code).toBe(
        'TOO_MANY_SUBSCRIPTIONS',
      );

      first.abort();
      await waitFor(() => bus.subscriptionCount() === 0, {
        description: 'suscripción liberada tras desconectar',
      });

      // el cupo se recupera
      const again = new AbortController();
      const reopened = await open(again.signal);
      expect(reopened.headers.get('content-type')).toContain('text/event-stream');
      void reopened.body
        ?.getReader()
        .read()
        .catch(() => undefined);
      await ready(1);
      again.abort();
    } finally {
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => {
        httpServer.close(() => {
          resolve();
        });
      });
    }
  });
});

describe('canal de notificaciones', () => {
  it('si el oyente pierde la conexión, los suscritos reciben ResyncRequired y siguen recibiendo después', async () => {
    const client = await subscribe(server(), lotId);
    await ready(1);
    const pid = listener.backendPid();
    expect(pid).toBeDefined();
    await db.pool.query('SELECT pg_terminate_backend($1)', [pid]);

    expect((await client.next())?.data?.lotUpdated).toMatchObject({ __typename: 'ResyncRequired' });

    const n = notificationFor(
      buildEvent('LotExtended', TENANT, {
        lotId,
        newClosesAt: '2030-03-01T00:00:00.000Z',
        reason: 'anti-sniping',
      }),
    );
    await publish(n);
    expect((await client.next())?.data?.lotUpdated).toMatchObject({
      __typename: 'LotExtendedUpdate',
      newClosesAt: '2030-03-01T00:00:00.000Z',
    });
  });
});
