import type { EventDraft } from '../draft.js';
import { formatMoney } from '../money.js';
import type { LotState } from './state.js';

/**
 * Reglas 4 y 5: al llegar `closesAt` el lote se adjudica al mejor postor (o se cierra desierto
 * si no hubo pujas). Antes de la hora, o sobre un lote ya cerrado, no emite nada: un lote nunca
 * se adjudica dos veces.
 */
export function decideCloseLot(state: LotState, now: Date): EventDraft[] {
  if (state.status === 'closed' || now.getTime() < state.closesAt.getTime()) return [];
  return [
    {
      type: 'LotClosed',
      payload: {
        lotId: state.lotId,
        winnerId: state.currentBidderId,
        finalAmount: state.currentPrice === null ? null : formatMoney(state.currentPrice),
      },
    },
  ];
}
