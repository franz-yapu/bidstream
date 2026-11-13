import { evolveLot, type DomainEvent } from '@bidstream/domain';
import type { DbClient } from '../repositories/transaction.js';
import { PrismaLotDecisionRepository } from './lot-decision-repository.js';

/** El estado de decisión de un lote no se puede avanzar (evento sin `LotPublished` previo). */
export class DecisionStateError extends Error {
  override readonly name = 'DecisionStateError';
}

/**
 * Aplica un evento ya ocurrido al estado de decisión (con la misma `evolveLot` que el dominio y el
 * proyector). `LotPublished` lo crea; `BidPlaced`, `LotExtended` y `LotClosed` lo avanzan. Los demás
 * eventos no afectan al decisor. Lanza `DecisionStateError` si el lote no existe: el procesador
 * reintenta y, agotados los intentos, el evento va al DLQ.
 */
export async function applyEventToDecision(tx: DbClient, event: DomainEvent): Promise<void> {
  if (
    event.type !== 'LotPublished' &&
    event.type !== 'BidPlaced' &&
    event.type !== 'LotExtended' &&
    event.type !== 'LotClosed'
  ) {
    return;
  }
  const repository = new PrismaLotDecisionRepository(tx);
  const state = await repository.findForUpdate(event.tenantId, event.payload.lotId);
  if (event.type === 'LotPublished') {
    if (state !== null) return; // ya conocido: reentrega idempotente
    const created = evolveLot(undefined, event);
    if (created !== undefined) await repository.save(event.tenantId, created);
    return;
  }
  if (state === null) {
    throw new DecisionStateError(`el lote ${event.payload.lotId} no tiene estado de decisión`);
  }
  const next = evolveLot(state, event);
  if (next !== undefined) await repository.save(event.tenantId, next);
}
