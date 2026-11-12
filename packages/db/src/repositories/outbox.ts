import { partitionKey, type DomainEvent } from '@bidstream/domain';
import type { Prisma } from '../generated/client.js';
import type { DbClient } from './transaction.js';

/**
 * Escribe eventos de dominio en la tabla `outbox_message`. Debe usarse dentro de la misma
 * transacción que la validación del comando (spec §5): el relay (D1) los publica después.
 */
export class PrismaOutbox {
  constructor(private readonly db: DbClient) {}

  /**
   * Una sola inserción (todo o nada). El `id` de la fila es el `eventId`: reintentar el mismo
   * evento falla por clave primaria en lugar de duplicar el mensaje.
   */
  async enqueue(events: readonly DomainEvent[], topic: string): Promise<void> {
    if (events.length === 0) return;
    await this.db.outboxMessage.createMany({
      data: events.map((event) => ({
        id: event.eventId,
        topic,
        key: partitionKey(event),
        payload: JSON.parse(JSON.stringify(event)) as Prisma.InputJsonObject,
      })),
    });
  }
}
