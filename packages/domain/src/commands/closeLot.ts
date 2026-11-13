import { z } from 'zod';
import { defineCommand } from './envelope.js';
import { uuid } from '../events/primitives.js';

/**
 * Señal de tiempo: «ya pasó `closesAt` de este lote». La emite el `closer` (D8) y la decide el
 * decisor por la **misma partición que las pujas**: así el cierre y las pujas tienen un único orden.
 * No es un hecho: si el lote se extendió (anti-sniping) o ya está cerrado, el decisor no emite nada.
 */
export const closeLot = defineCommand('CloseLot', z.strictObject({ lotId: uuid }));
