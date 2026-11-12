import { randomUUID } from 'node:crypto';
import { createTestTopic, testKafkaConfig, waitFor, type TestTopic } from '@bidstream/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKafkaAdmin, GroupNotEmptyError, type KafkaAdmin } from './admin.js';
import { createConsumer } from './consumer.js';
import { createProducer } from './producer.js';

const config = testKafkaConfig();
let topic: TestTopic;
let admin: KafkaAdmin;

beforeAll(async () => {
  topic = await createTestTopic({ partitions: 3 });
  admin = await createKafkaAdmin(config);
  const producer = await createProducer(config);
  try {
    for (let i = 0; i < 6; i++) {
      await producer.publish(topic.name, { key: `k${String(i)}`, value: String(i) });
    }
  } finally {
    await producer.disconnect();
  }
});
afterAll(async () => {
  await admin.disconnect();
  await topic.drop();
});

describe('administración de grupos (Kafka real)', () => {
  it('un grupo que no existe: describeGroup devuelve null y deleteGroup no falla', async () => {
    const groupId = `g-${randomUUID()}`;
    expect(await admin.describeGroup(groupId)).toBeNull();
    await expect(admin.deleteGroup(groupId)).resolves.toBeUndefined();
  });

  it('consumerLag: el total antes de consumir, 0 después, y vuelve al total al borrar el grupo', async () => {
    const groupId = `g-${randomUUID()}`;
    const before = await admin.consumerLag(groupId, topic.name);
    expect(before.total).toBe(6);
    expect(before.partitions).toHaveLength(3);

    let seen = 0;
    const consumer = await createConsumer(config, { groupId, topics: [topic.name] });
    void consumer.run(() => {
      seen += 1;
      return Promise.resolve();
    });
    await waitFor(() => seen === 6, { description: 'seis mensajes' });
    await waitFor(async () => (await admin.consumerLag(groupId, topic.name)).total === 0, {
      description: 'lag 0',
    });

    // con el consumidor activo el grupo tiene miembros y no se puede borrar
    const active = await admin.describeGroup(groupId);
    expect(active?.members).toBe(1);
    await expect(admin.deleteGroup(groupId)).rejects.toThrow(GroupNotEmptyError);

    await consumer.disconnect();
    await waitFor(async () => (await admin.describeGroup(groupId))?.members === 0, {
      description: 'el grupo queda vacío',
    });
    await admin.deleteGroup(groupId);
    expect(await admin.describeGroup(groupId)).toBeNull();
    // sin offsets confirmados, el grupo volvería a leer todo desde el principio
    expect((await admin.consumerLag(groupId, topic.name)).total).toBe(6);
  });
});
