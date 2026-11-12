import { KafkaJS } from '@confluentinc/kafka-javascript';
import { createProducer } from '@bidstream/kafka';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
  collectMessages,
  createTestDatabase,
  createTestTopic,
  testDatabaseServerUrl,
  testKafkaConfig,
} from './index.js';

async function databaseExists(name: string): Promise<boolean> {
  const admin = new pg.Client({ connectionString: testDatabaseServerUrl() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    return rowCount === 1;
  } finally {
    await admin.end();
  }
}

describe('createTestDatabase', () => {
  it('deja las tablas migradas y drop() elimina la base', async () => {
    const db = await createTestDatabase();
    const name = new URL(db.url).pathname.slice(1);
    const { rows } = await db.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' ORDER BY 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'auction',
      'audit_log',
      'bid',
      'lot',
      'outbox_message',
      'processed_event',
    ]);
    expect(await databaseExists(name)).toBe(true);
    await db.drop();
    expect(await databaseExists(name)).toBe(false);
  });

  it('dos llamadas simultáneas obtienen bases distintas y aisladas', async () => {
    const [a, b] = await Promise.all([createTestDatabase(), createTestDatabase()]);
    try {
      expect(a.url).not.toBe(b.url);
      await a.pool.query(
        `INSERT INTO processed_event (event_id, consumer) VALUES (gen_random_uuid(), 'x')`,
      );
      const inA = await a.pool.query('SELECT count(*)::int AS n FROM processed_event');
      const inB = await b.pool.query('SELECT count(*)::int AS n FROM processed_event');
      expect(inA.rows[0]).toEqual({ n: 1 });
      expect(inB.rows[0]).toEqual({ n: 0 });
    } finally {
      await Promise.all([a.drop(), b.drop()]);
    }
  });
});

describe('Kafka de pruebas', () => {
  const admin = (): KafkaJS.Admin =>
    new KafkaJS.Kafka({ 'bootstrap.servers': testKafkaConfig().brokers.join(',') }).admin();

  it('createTestTopic crea el topic con las particiones pedidas y drop() lo borra', async () => {
    const topic = await createTestTopic({ partitions: 3 });
    const a = admin();
    await a.connect();
    try {
      const meta = await a.fetchTopicMetadata({ topics: [topic.name] });
      expect(meta[0]?.partitions).toHaveLength(3);
      await topic.drop();
      expect(await a.listTopics()).not.toContain(topic.name);
    } finally {
      await a.disconnect();
    }
  });

  it('collectMessages devuelve exactamente `count` mensajes', async () => {
    const topic = await createTestTopic();
    const producer = await createProducer(testKafkaConfig());
    try {
      for (const n of ['1', '2', '3']) await producer.publish(topic.name, { key: 'k', value: n });
      const got = await collectMessages({ topic: topic.name, count: 2 });
      expect(got.map((m) => m.value)).toEqual(['1', '2']);
    } finally {
      await producer.disconnect();
      await topic.drop();
    }
  });

  it('collectMessages falla con un error claro al agotar el tiempo', async () => {
    const topic = await createTestTopic();
    try {
      await expect(
        collectMessages({ topic: topic.name, count: 1, timeoutMs: 4_000 }),
      ).rejects.toThrow(/se recibieron 0 de 1 mensajes/);
    } finally {
      await topic.drop();
    }
  });
});
