import {
  createEventConsumer,
  type EventConsumer,
  type EventConsumerOptions,
} from '@bidstream/consumer';
import { CONSUMER_GROUPS } from '@bidstream/kafka';
import { publishNotification, toLotNotification } from '@bidstream/notifier';

export type NotifierOptions = Omit<EventConsumerOptions, 'consumerName' | 'handler'> & {
  /** Grupo del consumidor; por defecto `notifier`. Solo las pruebas lo cambian. */
  readonly groupId?: string;
};

/**
 * El consumidor `notifier` (grupo único): convierte cada evento de lote en una notificación pública y
 * la difunde con `NOTIFY` **dentro de la transacción** del consumidor base. Todas las réplicas del
 * servidor GraphQL la reciben porque cada una escucha el canal (docs/sdd/D5/SDD.md §2.1).
 */
export function createNotifier(options: NotifierOptions): Promise<EventConsumer> {
  const { groupId, ...rest } = options;
  return createEventConsumer({
    ...rest,
    consumerName: groupId ?? CONSUMER_GROUPS.notifier,
    handler: async (event, { tx }) => {
      const notification = toLotNotification(event);
      if (notification !== null) await publishNotification(tx, notification);
    },
  });
}
