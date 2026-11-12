import { randomUUID } from 'node:crypto';
import { buildEvent, type EventOf } from '@bidstream/domain';
import {
  collectMessages,
  createTestTopic,
  testKafkaConfig,
  type TestTopic,
} from '@bidstream/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConsumer, type IncomingMessage } from './consumer.js';
import { createProducer, type KafkaProducer } from './producer.js';

const config = testKafkaConfig();
const TENANT = '11111111-1111-4111-8111-111111111111';
let topic: TestTopic;
let producer: KafkaProducer;

const closed = (lotId: string): EventOf<'LotClosed'> =>
  buildEvent('LotClosed', TENANT, { lotId, winnerId: null, finalAmount: null });
const lotId = (n: number): string => `0000000${String(n)}-0000-4000-8000-000000000000`;

beforeAll(async () => {
  topic = await createTestTopic({ partitions: 6 });
  producer = await createProducer(config, { eventsTopic: topic.name });
});

afterAll(async () => {
  await producer.disconnect();
  await topic.drop();
});

describe('Kafka real (make up)', () => {
  it('publishEvent usa clave = lotId y cabeceras eventId/type/version', async () => {
    const event = closed(lotId(1));
    await producer.publishEvent(event);
    const [m] = await collectMessages({ topic: topic.name, count: 1 });
    expect(m?.key).toBe(lotId(1));
    expect(m?.headers).toEqual({ eventId: event.eventId, type: 'LotClosed', version: '1' });
    expect(JSON.parse(m?.value ?? 'null')).toEqual(event);
  });

  it('eventos del mismo lote: misma partición y en orden; grupos independientes', async () => {
    const events = Array.from({ length: 12 }, (_, i) => closed(lotId((i % 3) + 1)));
    for (const e of events) await producer.publishEvent(e);

    const total = 13; // 1 del test anterior + 12
    const [a, b] = await Promise.all([
      collectMessages({ topic: topic.name, count: total }),
      collectMessages({ topic: topic.name, count: total }),
    ]);
    // dos grupos distintos reciben todo el historial (earliest) de forma independiente
    expect(a).toHaveLength(total);
    expect(b).toHaveLength(total);

    const byLot = new Map<string, IncomingMessage[]>();
    for (const m of a) byLot.set(m.key ?? '', [...(byLot.get(m.key ?? '') ?? []), m]);
    for (const [, msgs] of byLot) {
      expect(new Set(msgs.map((m) => m.partition)).size).toBe(1);
      const offsets = msgs.map((m) => Number(m.offset));
      expect(offsets).toEqual([...offsets].sort((x, y) => x - y));
    }
    const sent = events.filter((e) => e.payload.lotId === lotId(1)).map((e) => e.eventId);
    const got = (byLot.get(lotId(1)) ?? [])
      .map((m) => m.headers['eventId'])
      .filter((id) => sent.includes(id ?? ''));
    expect(got).toEqual(sent);
  });

  it('no confirma el offset si el handler falla: el mensaje se vuelve a entregar', async () => {
    const t = await createTestTopic();
    const p = await createProducer(config, { eventsTopic: t.name });
    const event = closed(lotId(9));
    await p.publishEvent(event);
    const groupId = `g-${randomUUID()}`;

    const first = await createConsumer(config, { groupId, topics: [t.name] });
    let attempts = 0;
    await new Promise<void>((resolve) => {
      void first
        .run(() => {
          attempts += 1;
          resolve();
          return Promise.reject(new Error('fallo simulado'));
        })
        .catch(() => undefined);
    });
    await first.disconnect().catch(() => undefined);
    expect(attempts).toBeGreaterThanOrEqual(1);

    const [redelivered] = await collectMessages({ topic: t.name, groupId, count: 1 });
    expect(redelivered?.headers['eventId']).toBe(event.eventId);
    await p.disconnect();
    await t.drop();
  });

  it('publicar en un topic inexistente falla (auto-creación desactivada)', async () => {
    const p = await createProducer(config, { eventsTopic: `bidstream.no-existe.${randomUUID()}` });
    await expect(p.publishEvent(closed(lotId(5)))).rejects.toThrow();
    await p.disconnect();
  });
});
