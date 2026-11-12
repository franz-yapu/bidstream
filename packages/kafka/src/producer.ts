import { partitionKey, type DomainEvent } from '@bidstream/domain';
import type { KafkaConfig } from './config.js';
import { createKafka } from './client.js';
import { TOPICS } from './topics.js';

export interface OutgoingMessage {
  readonly key: string;
  readonly value: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface KafkaProducer {
  publish(topic: string, message: OutgoingMessage): Promise<void>;
  /** Publica un evento de dominio en `bidstream.events.lot` con clave `partitionKey(event)`. */
  publishEvent(event: DomainEvent): Promise<void>;
  disconnect(): Promise<void>;
}

export interface ProducerOptions {
  /** Topic de `publishEvent`; por defecto `bidstream.events.lot` (las pruebas usan uno propio). */
  readonly eventsTopic?: string;
}

/** Productor idempotente con `acks=all`: sin duplicados por reintentos del productor. */
export async function createProducer(
  config: KafkaConfig,
  options: ProducerOptions = {},
): Promise<KafkaProducer> {
  const producer = createKafka(config).producer({ kafkaJS: { idempotent: true, acks: -1 } });
  await producer.connect();

  const publish = async (topic: string, message: OutgoingMessage): Promise<void> => {
    await producer.send({
      topic,
      messages: [
        {
          key: message.key,
          value: message.value,
          ...(message.headers === undefined ? {} : { headers: { ...message.headers } }),
        },
      ],
    });
  };

  return {
    publish,
    publishEvent: (event) =>
      publish(options.eventsTopic ?? TOPICS.eventsLot, {
        key: partitionKey(event),
        value: JSON.stringify(event),
        headers: { eventId: event.eventId, type: event.type, version: String(event.version) },
      }),
    disconnect: () => producer.disconnect(),
  };
}
