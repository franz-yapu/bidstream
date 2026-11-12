import type { KafkaConfig } from './config.js';
import { createKafka } from './client.js';

export interface IncomingMessage {
  readonly topic: string;
  readonly partition: number;
  readonly offset: string;
  readonly key: string | null;
  readonly value: string | null;
  readonly headers: Readonly<Record<string, string>>;
}

export type MessageHandler = (message: IncomingMessage) => Promise<void>;

export interface KafkaConsumer {
  /**
   * Procesa mensajes en orden por partición. El offset se confirma **solo** cuando el handler
   * resuelve: si lanza, el mensaje no se confirma y volverá a entregarse (al menos una vez).
   */
  run(handler: MessageHandler): Promise<void>;
  disconnect(): Promise<void>;
}

export interface ConsumerOptions {
  readonly groupId: string;
  readonly topics: readonly string[];
  /** `true` (defecto): un grupo nuevo lee el historial completo (reproceso, spec §5). */
  readonly fromBeginning?: boolean;
}

function headersToRecord(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [name, value] of Object.entries(raw)) {
    const v: unknown = Array.isArray(value) ? value[0] : value;
    if (typeof v === 'string') out[name] = v;
    else if (Buffer.isBuffer(v)) out[name] = v.toString('utf8');
  }
  return out;
}

/** Consumidor de un grupo con commit manual de offsets. */
export async function createConsumer(
  config: KafkaConfig,
  options: ConsumerOptions,
): Promise<KafkaConsumer> {
  const consumer = createKafka(config).consumer({
    kafkaJS: {
      groupId: options.groupId,
      fromBeginning: options.fromBeginning ?? true,
      autoCommit: false,
    },
  });
  await consumer.connect();
  await consumer.subscribe({ topics: [...options.topics] });

  return {
    run: (handler) =>
      consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          await handler({
            topic,
            partition,
            offset: message.offset,
            key: message.key?.toString('utf8') ?? null,
            value: message.value?.toString('utf8') ?? null,
            headers: headersToRecord(message.headers),
          });
          await consumer.commitOffsets([
            { topic, partition, offset: (BigInt(message.offset) + 1n).toString() },
          ]);
        },
      }),
    // `stop()` no está implementado en @confluentinc/kafka-javascript: `disconnect()` detiene el
    // consumo de forma ordenada y confirma lo pendiente.
    disconnect: () => consumer.disconnect(),
  };
}
