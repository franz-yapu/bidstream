import { z } from 'zod';
import { EVENT_VERSION, metaSchema } from '../events/envelope.js';
import { isoDateTime, uuid, uuidV7 } from '../events/primitives.js';

/** Versión del esquema de los comandos (mismo criterio que los eventos). */
export const COMMAND_VERSION = EVENT_VERSION;

/**
 * Sobre común de un comando: una **petición** de cambio que aún no ocurrió. `receivedAt` es la hora
 * de la API y es la que usa el decisor, para que el resultado no dependa de cuándo se procese.
 */
export function defineCommand<const T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.strictObject({
    commandId: uuidV7,
    type: z.literal(type),
    receivedAt: isoDateTime,
    tenantId: uuid,
    version: z.literal(COMMAND_VERSION),
    payload,
    meta: metaSchema.optional(),
  });
}
