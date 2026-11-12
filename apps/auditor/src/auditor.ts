import { recordAuditEntry } from '@bidstream/db';
import {
  createEventConsumer,
  type EventConsumer,
  type EventConsumerOptions,
} from '@bidstream/consumer';
import { CONSUMER_GROUPS } from '@bidstream/kafka';

export type AuditorOptions = Omit<EventConsumerOptions, 'consumerName' | 'handler'>;

/**
 * El consumidor `auditor`: registra **todos** los eventos de `bidstream.events.lot` (incluidos los
 * `BidRejected`, que el `projector` ignora) en la bitácora append-only, sin transformarlos.
 */
export function createAuditor(options: AuditorOptions): Promise<EventConsumer> {
  return createEventConsumer({
    ...options,
    consumerName: CONSUMER_GROUPS.auditor,
    handler: (event, { tx, message }) =>
      recordAuditEntry(tx, event, {
        topic: message.topic,
        partition: message.partition,
        offset: message.offset,
      }),
  });
}
