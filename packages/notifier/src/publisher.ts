import type { PrismaClient } from '@bidstream/db';
import { lotNotificationSchema, type LotNotification } from './notification.js';

/** Canal de PostgreSQL por el que viajan las notificaciones de lote. */
export const NOTIFICATION_CHANNEL = 'lot_updates';

/** El límite de la carga de `NOTIFY` es 8 000 bytes; se deja margen. */
export const MAX_NOTIFICATION_BYTES = 7_500;

/**
 * Difunde una notificación con `pg_notify`. Debe llamarse **dentro** de la transacción del consumidor
 * base (D3): PostgreSQL la entrega al confirmar, de modo que se notifica si y solo si el evento
 * queda registrado como procesado; si la transacción se revierte, no se emite nada.
 */
export async function publishNotification(
  tx: Pick<PrismaClient, '$executeRaw'>,
  notification: LotNotification,
): Promise<void> {
  const payload = JSON.stringify(lotNotificationSchema.parse(notification));
  if (Buffer.byteLength(payload) > MAX_NOTIFICATION_BYTES) {
    throw new RangeError(
      `la notificación ocupa ${String(Buffer.byteLength(payload))} bytes y NOTIFY admite menos de 8000`,
    );
  }
  await tx.$executeRaw`SELECT pg_notify(${NOTIFICATION_CHANNEL}, ${payload})`;
}
