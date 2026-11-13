import { randomUUID } from 'node:crypto';
import { buildDlqMessage } from '@bidstream/consumer';
import type { PrismaClient } from '@bidstream/db';
import { buildEvent, FixedClock, SequentialIdGenerator, type DomainEvent } from '@bidstream/domain';
import {
  createConsumer,
  createKafkaAdmin,
  createProducer,
  type KafkaAdmin,
} from '@bidstream/kafka';
import {
  collectMessages,
  createTestTopic,
  testKafkaConfig,
  waitFor,
  warmUpGroupCoordinator,
  type TestTopic,
} from '@bidstream/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { lazyDlqAdmin } from './admin-dlq.js';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { HeaderTenantResolver } from './tenant.js';

// Administración del DLQ por HTTP contra Kafka real (la base de datos no interviene).
const kafka = testKafkaConfig();
const KEY = 'una-clave-de-servicio-de-al-menos-32-caracteres';
const TENANT = '11111111-1111-4111-8111-111111111111';
const config = loadConfig({
  LOG_LEVEL: 'info',
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
});
const noDb = new Proxy(
  {},
  {
    get: () => {
      throw new Error('la administración del DLQ no usa la base de datos');
    },
  },
) as unknown as PrismaClient;

let admin: KafkaAdmin;
let events: TestTopic;
let dlq: TestTopic;
let group: string;
let app: FastifyInstance | undefined;
let logs: string[] = [];

beforeAll(async () => {
  await warmUpGroupCoordinator();
  admin = await createKafkaAdmin(kafka);
}, 120_000);
afterAll(async () => {
  await admin.disconnect();
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  await Promise.all([events.drop(), dlq.drop()]);
});

async function start(options: { withKey?: boolean } = {}): Promise<FastifyInstance> {
  [events, dlq] = await Promise.all([createTestTopic({ partitions: 2 }), createTestTopic()]);
  group = `dlq-reprocessor-http-${randomUUID()}`;
  logs = [];
  app = buildApp({
    config,
    prisma: noDb,
    clock: new FixedClock(new Date('2026-11-13T10:00:00.000Z')),
    ids: new SequentialIdGenerator(),
    tenantResolver: new HeaderTenantResolver(),
    eventsTopic: events.name,
    logStream: { write: (chunk) => void logs.push(chunk) },
    ...(options.withKey === false
      ? {}
      : {
          adminDlq: {
            apiKey: KEY,
            port: lazyDlqAdmin({
              env: { KAFKA_BROKERS: kafka.brokers.join(',') },
              overrides: { dlqTopic: dlq.name, reprocessorGroup: group, timeoutMs: 20_000 },
            }),
          },
        }),
  });
  return app;
}

async function seed(count: number, extra: { poison?: boolean } = {}): Promise<DomainEvent[]> {
  const producer = await createProducer(kafka);
  const created: DomainEvent[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const event = buildEvent('LotClosed', TENANT, {
        lotId: randomUUID(),
        winnerId: null,
        finalAmount: null,
      });
      created.push(event);
      const poison = extra.poison === true && i === 0;
      const dlqMessage = buildDlqMessage({
        message: {
          topic: events.name,
          partition: 0,
          offset: String(i),
          key: (event.payload as { lotId: string }).lotId,
          value: poison ? '{roto' : JSON.stringify(event),
          headers: {},
        },
        consumer: 'projector',
        error: new Error('fallo simulado'),
        attempts: poison ? 1 : 4,
        reason: poison ? 'poison' : 'retries-exhausted',
        now: new Date(),
      });
      await producer.publish(dlq.name, { key: 'k', value: JSON.stringify(dlqMessage) });
    }
  } finally {
    await producer.disconnect();
  }
  return created;
}

const headers = { 'x-admin-key': KEY };

describe('protección', () => {
  it('sin ADMIN_API_KEY las rutas de administración no existen (404)', async () => {
    const server = await start({ withKey: false });
    expect((await server.inject({ method: 'GET', url: '/v1/admin/dlq', headers })).statusCode).toBe(
      404,
    );
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/v1/admin/dlq/reprocess',
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  });

  it.each([
    ['sin cabecera', undefined],
    ['clave incorrecta', 'x'.repeat(KEY.length)],
    ['clave más corta', 'x'],
    ['clave más larga', `${KEY}${KEY}`],
    ['clave vacía', ''],
  ])('%s → 401 problem+json sin pistas, en las dos rutas', async (_name, key) => {
    const server = await start();
    const h = key === undefined ? {} : { 'x-admin-key': key };
    for (const reply of [
      await server.inject({ method: 'GET', url: '/v1/admin/dlq', headers: h }),
      await server.inject({
        method: 'POST',
        url: '/v1/admin/dlq/reprocess',
        headers: h,
        payload: {},
      }),
    ]) {
      expect(reply.statusCode).toBe(401);
      expect(reply.headers['content-type']).toContain('application/problem+json');
      expect(reply.body).not.toContain(KEY);
      expect(reply.json()).toMatchObject({
        type: 'urn:bidstream:problem:unauthorized',
        status: 401,
      });
    }
  });

  it('la clave correcta da acceso', async () => {
    const server = await start();
    expect((await server.inject({ method: 'GET', url: '/v1/admin/dlq', headers })).statusCode).toBe(
      200,
    );
  });
});

describe('GET /v1/admin/dlq', () => {
  it('lista el DLQ sin consumirlo y solo incluye el valor original si se pide', async () => {
    const server = await start();
    const created = await seed(3);
    const first = await server.inject({ method: 'GET', url: '/v1/admin/dlq', headers });
    const second = await server.inject({ method: 'GET', url: '/v1/admin/dlq', headers });
    expect(second.json()).toEqual(first.json());
    const body = first.json<{
      entries: Record<string, unknown>[];
      pending: number;
      total: number;
    }>();
    expect(body).toMatchObject({ pending: 3, total: 3 });
    expect(body.entries.map((e) => e['eventId'])).toEqual(created.map((e) => e.eventId));
    expect(body.entries[0]).not.toHaveProperty('original');
    const withOriginal = await server.inject({
      method: 'GET',
      url: '/v1/admin/dlq?includeOriginal=true',
      headers,
    });
    expect(withOriginal.json<{ entries: { original: string }[] }>().entries[0]?.original).toBe(
      JSON.stringify(created[0]),
    );
  });

  it.each(['limit=0', 'limit=1001', 'limit=abc', 'includeOriginal=quizá'])(
    'rechaza %s con 400',
    async (query) => {
      const server = await start();
      expect(
        (await server.inject({ method: 'GET', url: `/v1/admin/dlq?${query}`, headers })).statusCode,
      ).toBe(400);
    },
  );
});

describe('POST /v1/admin/dlq/reprocess', () => {
  it('republica los pendientes en el topic original y devuelve el resumen', async () => {
    const server = await start();
    const created = await seed(3, { poison: true });
    const reply = await server.inject({
      method: 'POST',
      url: '/v1/admin/dlq/reprocess',
      headers,
      payload: {},
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({
      mode: 'pending',
      examined: 3,
      republished: 2,
      skipped: { poison: 1 },
      remaining: 0,
    });
    const messages = await collectMessages({ topic: events.name, count: 2 });
    expect(messages.map((m) => m.headers['eventId']).sort()).toEqual(
      [created[1]?.eventId, created[2]?.eventId].sort(),
    );
  });

  it('el modo selectivo republica solo lo pedido', async () => {
    const server = await start();
    const created = await seed(3);
    const reply = await server.inject({
      method: 'POST',
      url: '/v1/admin/dlq/reprocess',
      headers,
      payload: { eventIds: [created[1]?.eventId] },
    });
    expect(reply.json()).toMatchObject({
      mode: 'selective',
      republished: 1,
      republishedEventIds: [created[1]?.eventId],
      remaining: 3,
    });
  });

  it.each([
    ['limit y eventIds a la vez', { limit: 5, eventIds: [randomUUID()] }],
    ['limit 0', { limit: 0 }],
    ['limit 1001', { limit: 1_001 }],
    ['eventIds que no son UUID', { eventIds: ['no-es-uuid'] }],
    ['eventIds vacío', { eventIds: [] }],
    ['más de 100 eventIds', { eventIds: Array.from({ length: 101 }, () => randomUUID()) }],
    ['campo desconocido', { forzar: true }],
  ])('rechaza %s con 400 y no toca nada', async (_name, payload) => {
    const server = await start();
    await seed(1);
    const reply = await server.inject({
      method: 'POST',
      url: '/v1/admin/dlq/reprocess',
      headers,
      payload,
    });
    expect(reply.statusCode).toBe(400);
    expect((await admin.consumerLag(group, dlq.name)).total).toBe(1);
  });

  it('con otro reproceso en marcha responde 409', async () => {
    const server = await start();
    const holder = await createConsumer(kafka, { groupId: group, topics: [dlq.name] });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    void holder.run(() => held);
    try {
      await waitFor(async () => ((await admin.describeGroup(group))?.members ?? 0) > 0, {
        description: 'el grupo tiene un miembro',
      });
      const reply = await server.inject({
        method: 'POST',
        url: '/v1/admin/dlq/reprocess',
        headers,
        payload: {},
      });
      expect(reply.statusCode).toBe(409);
      expect(reply.json()).toMatchObject({ type: 'urn:bidstream:problem:conflict' });
    } finally {
      release();
      await holder.disconnect().catch(() => undefined);
    }
  });

  it('deja constancia en el log (requestId, modo y eventIds) y nunca el contenido de los eventos', async () => {
    const server = await start();
    const created = await seed(2);
    const reply = await server.inject({
      method: 'POST',
      url: '/v1/admin/dlq/reprocess',
      headers: { ...headers, 'x-request-id': 'op-reproceso-1' },
      payload: {},
    });
    expect(reply.statusCode).toBe(200);
    const line = logs
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l['msg'] === 'reproceso del DLQ');
    expect(line).toMatchObject({ requestId: 'op-reproceso-1', mode: 'pending', republished: 2 });
    expect(line?.['eventIds']).toEqual(created.map((e) => e.eventId));
    const text = logs.join('');
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('LotClosed'); // el contenido de los eventos no se registra
    expect(text).not.toContain('winnerId');
  });
});

describe('documentación', () => {
  it('OpenAPI incluye las rutas de administración, con su etiqueta', async () => {
    const server = await start();
    const doc = (await server.inject({ method: 'GET', url: '/v1/docs/json' })).json<{
      paths: Record<
        string,
        Record<string, { tags?: string[]; responses: Record<string, unknown> }>
      >;
    }>();
    expect(doc.paths['/v1/admin/dlq']?.['get']?.tags).toEqual(['administración']);
    expect(Object.keys(doc.paths['/v1/admin/dlq/reprocess']?.['post']?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '400', '401', '409']),
    );
  });

  it('sin clave configurada, las rutas tampoco aparecen en la documentación', async () => {
    const server = await start({ withKey: false });
    const doc = (await server.inject({ method: 'GET', url: '/v1/docs/json' })).json<{
      paths: Record<string, unknown>;
    }>();
    expect(Object.keys(doc.paths).some((p) => p.includes('/admin/'))).toBe(false);
  });
});
