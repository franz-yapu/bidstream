import { z } from 'zod';

/** UUID v7 estricto: identidad del evento y clave de idempotencia de los consumidores. */
export const uuidV7 = z.uuidv7();

/** UUID de agregado (`@db.Uuid` en la base); acepta cualquier versión RFC. */
export const uuid = z.uuid();

/** Instante ISO-8601 en UTC con sufijo `Z`; el log de eventos nunca guarda zonas horarias. */
export const isoDateTime = z.iso.datetime();

/**
 * Dinero como string decimal, nunca `number`: cabe en `Decimal(12,2)` (10 enteros, 2 decimales).
 * El JSON no tiene decimal nativo y un float pierde precisión (business-rules #6).
 */
export const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'monto decimal inválido');

/** ISO 4217: 3 letras mayúsculas (`Char(3)`). */
export const currency = z.string().regex(/^[A-Z]{3}$/, 'moneda de 3 letras mayúsculas');

export const title = z.string().trim().min(1).max(200);
