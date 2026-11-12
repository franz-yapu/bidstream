import { partitionKey, type DomainEvent } from '@bidstream/domain';
import type { Prisma, PrismaClient } from '../generated/client.js';

/** Posición del mensaje en el log de Kafka de la que se leyó el evento. */
export interface AuditSource {
  readonly topic: string;
  readonly partition: number;
  readonly offset: string;
}

/**
 * Registra un evento en la bitácora (`audit_log`). Solo inserta: la tabla es append-only. Debe
 * ejecutarse dentro de la transacción del consumidor base (D3), que ya garantiza una ejecución por
 * `(eventId, auditor)`; la clave primaria `event_id` es la segunda barrera contra duplicados.
 */
export async function recordAuditEntry(
  tx: Pick<PrismaClient, 'auditLog'>,
  event: DomainEvent,
  source: AuditSource,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      eventId: event.eventId,
      type: event.type,
      tenantId: event.tenantId,
      key: partitionKey(event),
      occurredAt: new Date(event.occurredAt),
      payload: JSON.parse(JSON.stringify(event)) as Prisma.InputJsonObject,
      sourceTopic: source.topic,
      sourcePartition: source.partition,
      sourceOffset: BigInt(source.offset),
    },
  });
}
