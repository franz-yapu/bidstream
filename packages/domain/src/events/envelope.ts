import { z } from 'zod';
import { isoDateTime, uuid, uuidV7 } from './primitives.js';

/** Versión del esquema de cada tipo de evento (spec §3: el campo `version`). */
export const EVENT_VERSION = 1;

/** Metadatos reservados para correlación (F4) y firma (F3); opcionales desde la versión 1. */
export const metaSchema = z.strictObject({
  correlationId: z.string().min(1).max(128).optional(),
  signature: z.string().min(1).optional(),
});

/** Fabrica el esquema completo de un evento: sobre común + payload específico. */
export function defineEvent<const T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.strictObject({
    eventId: uuidV7,
    type: z.literal(type),
    occurredAt: isoDateTime,
    tenantId: uuid,
    version: z.literal(EVENT_VERSION),
    payload,
    meta: metaSchema.optional(),
  });
}
