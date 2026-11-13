import {
  commandPartitionKey,
  partitionKey,
  type DomainCommand,
  type DomainEvent,
} from '@bidstream/domain';
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

  /**
   * Escribe un **comando** (p. ej. `PlaceBid`) en la misma tabla: lo publica el mismo relay, con el
   * mismo orden (ADR-0006). El `id` de la fila es el `commandId`, así que repetirlo falla por clave
   * primaria en lugar de duplicar el comando.
   */
  async enqueueCommand(command: DomainCommand, topic: string): Promise<void> {
    await this.db.outboxMessage.create({
      data: {
        id: command.commandId,
        topic,
        key: commandPartitionKey(command),
        payload: JSON.parse(JSON.stringify(command)) as Prisma.InputJsonObject,
      },
    });
  }

  /**
   * Reclama hasta `limit` mensajes pendientes, **en orden** `(created_at, id)`, bloqueándolos con
   * `FOR UPDATE SKIP LOCKED` hasta el final de la transacción en curso. Debe llamarse dentro de una
   * transacción (el relay, D1). El orden por `id` (UUID v7) desempata los eventos de un mismo comando.
   */
  async claimPending(limit: number): Promise<PendingOutboxMessage[]> {
    const rows = await this.db.$queryRaw<
      { id: string; topic: string; key: string; payload: unknown; created_at: Date }[]
    >`SELECT id, topic, key, payload, created_at
      FROM outbox_message
      WHERE published_at IS NULL
      ORDER BY created_at, id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`;
    return rows.map((r) => ({
      id: r.id,
      topic: r.topic,
      key: r.key,
      payload: r.payload,
      createdAt: r.created_at,
    }));
  }

  /** Marca como publicados los mensajes indicados. */
  async markPublished(ids: readonly string[], at: Date = new Date()): Promise<void> {
    if (ids.length === 0) return;
    await this.db.outboxMessage.updateMany({
      where: { id: { in: [...ids] } },
      data: { publishedAt: at },
    });
  }
}

/** Mensaje del outbox pendiente de publicar. */
export interface PendingOutboxMessage {
  readonly id: string;
  readonly topic: string;
  readonly key: string;
  /** El evento de dominio completo, como JSON. */
  readonly payload: unknown;
  readonly createdAt: Date;
}
