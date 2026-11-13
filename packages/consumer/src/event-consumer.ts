import type { PrismaClient } from '@bidstream/db';
import type { DomainEvent } from '@bidstream/domain';
import {
  createConsumer,
  createProducer,
  TOPICS,
  type KafkaConfig,
  type IncomingMessage,
} from '@bidstream/kafka';
import {
  createMessageProcessor,
  type EventHandler,
  type ProcessOutcome,
  type ProcessorDeps,
} from './processor.js';

export interface EventConsumerOptions<T = DomainEvent> extends Omit<
  ProcessorDeps<T>,
  'publishDlq' | 'prisma'
> {
  readonly kafka: KafkaConfig;
  readonly prisma: Pick<PrismaClient, '$transaction'>;
  /** Por defecto `[bidstream.events.lot]`. */
  readonly topics?: readonly string[];
  /** Por defecto `bidstream.events.lot.dlq`. */
  readonly dlqTopic?: string;
  /** `true` (defecto): un grupo nuevo lee el historial completo. */
  readonly fromBeginning?: boolean;
  /** Observabilidad: se invoca tras procesar cada mensaje (métricas llegan con H4). */
  readonly onOutcome?: (outcome: ProcessOutcome, message: IncomingMessage) => void;
}

export interface EventConsumer {
  /** Empieza a consumir; el offset se confirma solo cuando el mensaje terminó (procesado, duplicado o en DLQ). */
  run(): Promise<void>;
  disconnect(): Promise<void>;
}

/**
 * Consumidor base de `projector`, `notifier` y `auditor`: el nombre del consumidor es también el
 * grupo de Kafka. Cada uno solo aporta su `handler`.
 */
export async function createEventConsumer<T = DomainEvent>(
  options: EventConsumerOptions<T>,
): Promise<EventConsumer> {
  const { kafka, topics, dlqTopic, fromBeginning, onOutcome, ...processorOptions } = options;
  const consumer = await createConsumer(kafka, {
    groupId: options.consumerName,
    topics: topics ?? [TOPICS.eventsLot],
    ...(fromBeginning === undefined ? {} : { fromBeginning }),
  });
  const producer = await createProducer(kafka);

  const process = createMessageProcessor({
    ...processorOptions,
    publishDlq: (publication) =>
      producer.publish(dlqTopic ?? TOPICS.eventsLotDlq, {
        key: publication.key ?? '',
        value: publication.value,
        headers: publication.headers,
      }),
  });

  return {
    run: () =>
      consumer.run(async (message) => {
        const outcome = await process(message);
        onOutcome?.(outcome, message);
      }),
    disconnect: async () => {
      await consumer.disconnect();
      await producer.disconnect();
    },
  };
}

export type { EventHandler };
