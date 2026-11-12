import type { DomainEvent } from '../events/index.js';

/**
 * Publica eventos ya construidos. La implementación de la API los escribe en la tabla outbox
 * dentro de la misma transacción que la validación (spec §5); el puerto no revela cómo.
 */
export interface EventPublisher {
  publish(events: readonly DomainEvent[]): Promise<void>;
}
