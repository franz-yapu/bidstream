import { randomUUID } from 'node:crypto';
import { FixedClock } from '@bidstream/domain';
import { PrismaIdempotencyStore } from '@bidstream/db';
import { createTestDatabase, type TestDatabase } from '@bidstream/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { Uuid7Generator } from './system.js';

// C4: Idempotency-Key obligatoria. Solo necesita PostgreSQL: no se publica nada en Kafka.
const TENANT = '11111111-1111-4111-8111-111111111111';
const COMMANDS = 'bidstream.commands.bid';
const NOW = new Date('2026-11-14T12:00:00.000Z');

let db: TestDatabase;
let app: FastifyInstance;
let lotId: string;
let otherLotId: string;

const bidder = (): string => randomUUID();
const key = (): string => `clave-${randomUUID()}`;

function bid(options: { lot?: string; bidder?: string; amount?: string; key?: string | null }) {
  return app.inject({
    method: 'POST',
    url: `/v1/lots/${options.lot ?? lotId}/bids`,
    headers: {
      'x-bidder-id': options.bidder ?? bidder(),
      ...(options.key === null ? {} : { 'idempotency-key': options.key ?? key() }),
    },
    payload: { amount: options.amount ?? '100.00' },
  });
}

const commandRows = (): Promise<number> =>
  db.prisma.outboxMessage.count({ where: { topic: COMMANDS } });

async function insertLot(): Promise<string> {
  const id = randomUUID();
  await db.prisma.lot.create({
    data: {
      id,
      auctionId: randomUUID(),
      tenantId: TENANT,
      title: 'Lote',
      startingPrice: '100.00',
      minIncrement: '5.00',
      currency: 'USD',
      closesAt: new Date('2026-11-14T13:00:00.000Z'),
      status: 'OPEN',
    },
  });
  return id;
}

beforeAll(async () => {
  db = await createTestDatabase();
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
    eventsTopic: 'bidstream.events.lot',
    commandsTopic: COMMANDS,
  });
  lotId = await insertLot();
  otherLotId = await insertLot();
});

afterAll(async () => {
  await app.close();
  await db.drop();
});

describe('cabecera obligatoria', () => {
  it.each([
    ['ausente', null],
    ['demasiado corta', 'corta'],
    ['con caracteres no permitidos', 'clave con espacios y ñ 123456'],
    ['demasiado larga', 'x'.repeat(129)],
  ])('%s → 400 y no deja comando ni clave', async (_name, value) => {
    const before = await commandRows();
    const res = await bid({ key: value });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ errors?: unknown[] }>().errors?.length).toBeGreaterThan(0);
    expect(await commandRows()).toBe(before);
  });

  it('acepta los límites 16 y 128 caracteres', async () => {
    expect((await bid({ key: 'a'.repeat(16) })).statusCode).toBe(202);
    expect((await bid({ key: 'b'.repeat(128) })).statusCode).toBe(202);
  });
});

describe('repetición', () => {
  it('misma clave y misma petición → mismo commandId, un solo comando y Idempotency-Replayed', async () => {
    const who = bidder();
    const k = key();
    const before = await commandRows();
    const first = await bid({ bidder: who, key: k });
    const second = await bid({ bidder: who, key: k });
    expect([first.statusCode, second.statusCode]).toEqual([202, 202]);
    expect(second.json<{ commandId: string }>().commandId).toBe(
      first.json<{ commandId: string }>().commandId,
    );
    expect(first.headers['idempotency-replayed']).toBeUndefined();
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(await commandRows()).toBe(before + 1);
  });

  it('misma clave con otro monto o con otro lote → 422 y no crea comando', async () => {
    const who = bidder();
    const k = key();
    await bid({ bidder: who, key: k, amount: '100.00' });
    const before = await commandRows();
    const otherAmount = await bid({ bidder: who, key: k, amount: '105.00' });
    const otherLot = await bid({ bidder: who, key: k, lot: otherLotId });
    expect([otherAmount.statusCode, otherLot.statusCode]).toEqual([422, 422]);
    expect(otherAmount.json<{ type: string }>().type).toBe(
      'urn:bidstream:problem:idempotency-key-reused',
    );
    expect(await commandRows()).toBe(before);
  });

  it('20 peticiones simultáneas con la misma clave → un único comando', async () => {
    const who = bidder();
    const k = key();
    const before = await commandRows();
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => bid({ bidder: who, key: k })),
    );
    expect(responses.every((r) => r.statusCode === 202)).toBe(true);
    expect(new Set(responses.map((r) => r.json<{ commandId: string }>().commandId)).size).toBe(1);
    expect(await commandRows()).toBe(before + 1);
    expect(responses.filter((r) => r.headers['idempotency-replayed'] === 'true')).toHaveLength(19);
  });

  it('la misma clave para dos postores distintos → dos comandos independientes', async () => {
    const k = key();
    const before = await commandRows();
    const a = await bid({ key: k });
    const b = await bid({ key: k });
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    expect(a.json<{ commandId: string }>().commandId).not.toBe(
      b.json<{ commandId: string }>().commandId,
    );
    expect(await commandRows()).toBe(before + 2);
  });

  it('un lote desconocido no consume la clave: se puede reintentar cuando exista', async () => {
    const who = bidder();
    const k = key();
    const unknown = randomUUID();
    expect((await bid({ bidder: who, key: k, lot: unknown })).statusCode).toBe(404);
    expect(await db.prisma.idempotencyKey.count({ where: { bidderId: who } })).toBe(0);
    await db.prisma.lot.create({
      data: {
        id: unknown,
        auctionId: randomUUID(),
        tenantId: TENANT,
        title: 'Tardío',
        startingPrice: '100.00',
        minIncrement: '5.00',
        currency: 'USD',
        closesAt: new Date('2026-11-14T13:00:00.000Z'),
        status: 'OPEN',
      },
    });
    expect((await bid({ bidder: who, key: k, lot: unknown })).statusCode).toBe(202);
  });
});

describe('atomicidad y mantenimiento', () => {
  it('si falla el outbox se revierte también la clave', async () => {
    const who = bidder();
    const k = key();
    const failing = {
      $transaction: <T>(work: (tx: unknown) => Promise<T>) =>
        db.prisma.$transaction((tx) =>
          work(
            new Proxy(tx, {
              get: (target, prop, receiver) =>
                prop === 'outboxMessage'
                  ? { createMany: () => Promise.reject(new Error('outbox caído')) }
                  : (Reflect.get(target, prop, receiver) as unknown),
            }),
          ),
        ),
    };
    const { placeBid } = await import('./commands/index.js');
    await expect(
      placeBid(
        {
          prisma: failing as never,
          clock: new FixedClock(NOW),
          ids: new Uuid7Generator(),
          eventsTopic: 'bidstream.events.lot',
          commandsTopic: COMMANDS,
        },
        TENANT,
        who,
        lotId,
        { amount: '100.00', idempotencyKey: k },
      ),
    ).rejects.toThrow('outbox caído');
    expect(await db.prisma.idempotencyKey.count({ where: { bidderId: who } })).toBe(0);
    // y la clave sigue libre para un reintento real
    expect((await bid({ bidder: who, key: k })).statusCode).toBe(202);
  });

  it('countSince cuenta por postor y ventana; deleteOlderThan borra las caducadas', async () => {
    const store = new PrismaIdempotencyStore(db.prisma);
    const who = bidder();
    await bid({ bidder: who });
    await bid({ bidder: who });
    const old = key();
    await db.prisma.idempotencyKey.create({
      data: {
        tenantId: TENANT,
        bidderId: who,
        key: old,
        requestHash: 'x',
        commandId: randomUUID(),
        lotId,
        createdAt: new Date(Date.now() - 48 * 3_600_000),
      },
    });
    expect(await store.countSince(TENANT, who, new Date(Date.now() - 60_000))).toBe(2);
    expect(await store.countSince(TENANT, who, new Date(Date.now() - 72 * 3_600_000))).toBe(3);
    const deleted = await store.deleteOlderThan(new Date(Date.now() - 24 * 3_600_000));
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await db.prisma.idempotencyKey.count({ where: { bidderId: who } })).toBe(2);
  });
});

describe('documentación', () => {
  it('OpenAPI documenta la cabecera obligatoria y las respuestas 202/400/422', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/v1/docs/json' })).json<{
      paths: Record<
        string,
        Record<
          string,
          {
            parameters?: { name: string; required?: boolean }[];
            responses: Record<string, unknown>;
          }
        >
      >;
    }>();
    const op = doc.paths['/v1/lots/{id}/bids']?.['post'];
    expect(op?.parameters?.find((p) => p.name === 'idempotency-key')?.required).toBe(true);
    expect(Object.keys(op?.responses ?? {})).toEqual(expect.arrayContaining(['202', '400', '422']));
  });
});
