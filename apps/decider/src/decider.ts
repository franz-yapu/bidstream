import {
  commandCodec,
  createEventConsumer,
  type EventConsumer,
  type EventConsumerOptions,
} from '@bidstream/consumer';
import { applyEventToDecision, type PrismaClient } from '@bidstream/db';
import { type AntiSnipingConfig, type DomainCommand } from '@bidstream/domain';
import { TOPICS, type KafkaConfig } from '@bidstream/kafka';
import { DECIDER_STATE_CONSUMER, decideCloseLotCommand, decidePlaceBid } from './decide.js';

/** Grupo del decisor de comandos (también su nombre de consumidor en `processed_event`). */
export const DECIDER_GROUP = 'decider';

export interface DeciderOptions {
  readonly kafka: KafkaConfig;
  readonly prisma: Pick<PrismaClient, '$transaction'>;
  readonly antiSniping: AntiSnipingConfig;
  /** Por defecto `bidstream.commands.bid`. */
  readonly commandsTopic?: string;
  /** Por defecto `bidstream.events.lot` (destino de las decisiones y origen del estado). */
  readonly eventsTopic?: string;
  readonly dlqTopic?: string;
  /** Solo las pruebas cambian los grupos (los grupos de Kafka son globales en el clúster). */
  readonly commandsGroup?: string;
  readonly stateGroup?: string;
  readonly retry?: EventConsumerOptions['retry'];
  readonly logger?: EventConsumerOptions['logger'];
  readonly onCommandOutcome?: EventConsumerOptions<DomainCommand>['onOutcome'];
  readonly onStateOutcome?: EventConsumerOptions['onOutcome'];
}

export interface Decider {
  run(): Promise<void>;
  disconnect(): Promise<void>;
}

/**
 * El decisor de pujas (ADR-0011): dos consumidores en un proceso.
 *  - `commands`: lee `bidstream.commands.bid` (clave `lotId`, orden por partición) y decide.
 *  - `state`: mantiene `lot_decision` con los eventos que no son suyos (`LotPublished`, `LotClosed`…).
 */
export async function createDecider(options: DeciderOptions): Promise<Decider> {
  const eventsTopic = options.eventsTopic ?? TOPICS.eventsLot;
  const stateConsumer = options.stateGroup ?? DECIDER_STATE_CONSUMER;
  const common = {
    kafka: options.kafka,
    prisma: options.prisma,
    ...(options.dlqTopic === undefined ? {} : { dlqTopic: options.dlqTopic }),
    ...(options.retry === undefined ? {} : { retry: options.retry }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  };

  const commands = await createEventConsumer<DomainCommand>({
    ...common,
    consumerName: options.commandsGroup ?? DECIDER_GROUP,
    topics: [options.commandsTopic ?? TOPICS.commandsBid],
    codec: commandCodec,
    handler: async (command, { tx }) => {
      const deps = { antiSniping: options.antiSniping, eventsTopic, stateConsumer };
      switch (command.type) {
        case 'PlaceBid':
          await decidePlaceBid(tx, command, deps);
          break;
        case 'CloseLot':
          await decideCloseLotCommand(tx, command, deps);
          break;
      }
    },
    ...(options.onCommandOutcome === undefined ? {} : { onOutcome: options.onCommandOutcome }),
  });
  const state = await createEventConsumer({
    ...common,
    consumerName: stateConsumer,
    topics: [eventsTopic],
    handler: (event, { tx }) => applyEventToDecision(tx, event),
    ...(options.onStateOutcome === undefined ? {} : { onOutcome: options.onStateOutcome }),
  });

  return {
    run: async () => {
      await Promise.all([commands.run(), state.run()]);
    },
    disconnect: async () => {
      await Promise.all([commands.disconnect(), state.disconnect()]);
    },
  };
}

export type { EventConsumer };
