import { randomUUID } from 'node:crypto';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import {
  createConsumer,
  loadKafkaConfig,
  type IncomingMessage,
  type KafkaConfig,
} from '@bidstream/kafka';

/** Configuración del Kafka de pruebas: `KAFKA_BROKERS` del entorno o `localhost:9092` (`make up`). */
export function testKafkaConfig(): KafkaConfig {
  return loadKafkaConfig({ KAFKA_BROKERS: process.env['KAFKA_BROKERS'] ?? 'localhost:9092' });
}

export interface TestTopic {
  readonly name: string;
  /** Elimina el topic. */
  drop(): Promise<void>;
}

async function withAdmin<T>(work: (admin: KafkaJS.Admin) => Promise<T>): Promise<T> {
  const config = testKafkaConfig();
  const admin = new KafkaJS.Kafka({ 'bootstrap.servers': config.brokers.join(',') }).admin();
  await admin.connect();
  try {
    return await work(admin);
  } finally {
    await admin.disconnect();
  }
}

/**
 * Crea un topic desechable (`bidstream.test.<uuid>`). Las pruebas nunca escriben en los topics
 * reales: el log `bidstream.events.lot` tiene retención ilimitada y no debe ensuciarse.
 */
export async function createTestTopic(options: { partitions?: number } = {}): Promise<TestTopic> {
  const name = `bidstream.test.${randomUUID()}`;
  await withAdmin((admin) =>
    admin.createTopics({
      topics: [{ topic: name, numPartitions: options.partitions ?? 1, replicationFactor: 1 }],
    }),
  );
  return {
    name,
    drop: () => withAdmin((admin) => admin.deleteTopics({ topics: [name] })),
  };
}

export interface CollectOptions {
  readonly topic: string;
  readonly count: number;
  /** Grupo del consumidor; por defecto uno nuevo (lee desde el principio). */
  readonly groupId?: string;
  readonly timeoutMs?: number;
}

/** Lee exactamente `count` mensajes del topic o falla con un error claro al agotar el tiempo. */
export async function collectMessages(options: CollectOptions): Promise<IncomingMessage[]> {
  const { topic, count, groupId = `test-${randomUUID()}`, timeoutMs = 40_000 } = options;
  const received: IncomingMessage[] = [];
  const consumer = await createConsumer(testKafkaConfig(), { groupId, topics: [topic] });
  try {
    await new Promise<void>((resolveCollected, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `timeout: se recibieron ${String(received.length)} de ${String(count)} mensajes en ${topic}`,
          ),
        );
      }, timeoutMs);
      void consumer.run((message) => {
        received.push(message);
        if (received.length >= count) {
          clearTimeout(timer);
          resolveCollected();
        }
        return Promise.resolve();
      });
    });
  } finally {
    await consumer.disconnect();
  }
  return received.slice(0, count);
}
