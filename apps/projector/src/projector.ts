import { applyEventToProjection } from '@bidstream/db';
import {
  createEventConsumer,
  type EventConsumer,
  type EventConsumerOptions,
} from '@bidstream/consumer';
import { CONSUMER_GROUPS } from '@bidstream/kafka';

export type ProjectorOptions = Omit<EventConsumerOptions, 'consumerName' | 'handler'>;

/**
 * El consumidor `projector`: aplica cada evento de `bidstream.events.lot` a la proyección de
 * PostgreSQL, con la idempotencia, los reintentos y el DLQ del consumidor base (D3).
 */
export function createProjector(options: ProjectorOptions): Promise<EventConsumer> {
  return createEventConsumer({
    ...options,
    consumerName: CONSUMER_GROUPS.projector,
    handler: (event, { tx }) => applyEventToProjection(tx, event),
  });
}
