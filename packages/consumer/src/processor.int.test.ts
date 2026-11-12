import { randomUUID } from 'node:crypto';
import { buildEvent, type DomainEvent } from '@bidstream/domain';
import type { IncomingMessage } from '@bidstream/kafka';
import { createTestDatabase, type TestDatabase } from '@bidstream/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMessageProcessor, type DlqPublication } from './processor.js';

// Procesador contra PostgreSQL real, con un DLQ simulado: casos que no necesitan Kafka.
const TENANT = '11111111-1111-4111-8111-111111111111';
let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.drop();
});

const event = (): DomainEvent =>
  buildEvent('LotClosed', TENANT, { lotId: randomUUID(), winnerId: null, finalAmount: null });

const messageOf = (value: string | null): IncomingMessage => ({
  topic: 'bidstream.events.lot',
  partition: 0,
  offset: '7',
  key: 'k',
  value,
  headers: {},
});

const processed = async (eventId: string): Promise<number> => {
  const { rows } = await db.pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM processed_event WHERE event_id = $1',
    [eventId],
  );
  return rows[0]?.n ?? 0;
};

const fast = { baseDelayMs: 1, capMs: 1 };

describe('createMessageProcessor', () => {
  it('si el DLQ no se puede escribir, lanza (el offset no se confirma) y no queda registro', async () => {
    const e = event();
    const process = createMessageProcessor({
      prisma: db.prisma,
      consumerName: 'projector',
      handler: () => Promise.reject(new Error('fallo permanente')),
      publishDlq: () => Promise.reject(new Error('kafka caído')),
      retry: fast,
    });
    await expect(process(messageOf(JSON.stringify(e)))).rejects.toThrow('kafka caído');
    expect(await processed(e.eventId)).toBe(0);
  });

  it('una verificación fallida trata el mensaje como veneno, sin llamar al handler', async () => {
    const e = event();
    const dlq: DlqPublication[] = [];
    let calls = 0;
    const process = createMessageProcessor({
      prisma: db.prisma,
      consumerName: 'projector',
      handler: () => {
        calls += 1;
        return Promise.resolve();
      },
      publishDlq: (p) => {
        dlq.push(p);
        return Promise.resolve();
      },
      verify: () => false,
    });
    const outcome = await process(messageOf(JSON.stringify(e)));
    expect(outcome).toEqual({ kind: 'dead-lettered', reason: 'poison', attempts: 1 });
    expect(calls).toBe(0);
    expect(dlq[0]?.headers).toMatchObject({ reason: 'poison', eventId: e.eventId });
  });

  it('un mensaje sin valor es veneno', async () => {
    const process = createMessageProcessor({
      prisma: db.prisma,
      consumerName: 'projector',
      handler: () => Promise.resolve(),
      publishDlq: () => Promise.resolve(),
    });
    expect(await process(messageOf(null))).toEqual({
      kind: 'dead-lettered',
      reason: 'poison',
      attempts: 1,
    });
  });

  it('espera con backoff entre reintentos y usa el sleep inyectado', async () => {
    const e = event();
    const waits: number[] = [];
    const process = createMessageProcessor({
      prisma: db.prisma,
      consumerName: 'projector',
      handler: () => Promise.reject(new Error('siempre falla')),
      publishDlq: () => Promise.resolve(),
      retry: { baseDelayMs: 100, capMs: 10_000 },
      random: () => 1,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    const outcome = await process(messageOf(JSON.stringify(e)));
    expect(waits).toEqual([100, 200, 400]);
    expect(outcome).toEqual({ kind: 'dead-lettered', reason: 'retries-exhausted', attempts: 4 });
  });
});
