import { buildEvent, partitionKey } from '@bidstream/domain';
import { createProducer } from '@bidstream/kafka';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  collectMessages,
  createTestDatabase,
  createTestTopic,
  testKafkaConfig,
  type TestDatabase,
  type TestTopic,
} from './index.js';

// Ejemplo de uso de las utilidades: una fila de outbox cruza hasta Kafka. El relay real es D1;
// aquí se hace a mano para mostrar cómo se combinan base de datos, topic y consumidor.
let db: TestDatabase;
let topic: TestTopic;

beforeAll(async () => {
  [db, topic] = await Promise.all([createTestDatabase(), createTestTopic()]);
});
afterAll(async () => {
  await Promise.all([db.drop(), topic.drop()]);
});

describe('outbox → Kafka', () => {
  it('publica una fila pendiente con su clave y la marca como publicada', async () => {
    const event = buildEvent('LotClosed', '11111111-1111-4111-8111-111111111111', {
      lotId: '33333333-3333-4333-8333-333333333333',
      winnerId: null,
      finalAmount: null,
    });
    await db.prisma.outboxMessage.create({
      data: {
        id: event.eventId,
        topic: topic.name,
        key: partitionKey(event),
        payload: JSON.parse(JSON.stringify(event)) as object,
      },
    });

    const pending = await db.prisma.outboxMessage.findMany({ where: { publishedAt: null } });
    expect(pending).toHaveLength(1);

    const producer = await createProducer(testKafkaConfig());
    try {
      for (const row of pending) {
        await producer.publish(row.topic, { key: row.key, value: JSON.stringify(row.payload) });
        await db.prisma.outboxMessage.update({
          where: { id: row.id },
          data: { publishedAt: new Date() },
        });
      }
    } finally {
      await producer.disconnect();
    }

    const [message] = await collectMessages({ topic: topic.name, count: 1 });
    expect(message?.key).toBe('33333333-3333-4333-8333-333333333333');
    expect(JSON.parse(message?.value ?? 'null')).toEqual(event);
    expect(await db.prisma.outboxMessage.count({ where: { publishedAt: null } })).toBe(0);
  });
});
