import type { LotState } from '../lot/state.js';

/**
 * Lectura del estado actual de un lote (la proyección). Solo lectura a propósito: el estado lo
 * escribe únicamente el `projector` al consumir eventos; el lado de comandos publica eventos.
 */
export interface LotRepository {
  findById(tenantId: string, lotId: string): Promise<LotState | null>;
}
