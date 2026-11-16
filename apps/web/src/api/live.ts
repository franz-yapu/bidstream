import { fromCents, toCents } from '../lib/money';
import type { LotUpdate, LotWithAuction } from './types';

export interface Applied {
  readonly lot: LotWithAuction;
  /** `true` si se pudieron perder actualizaciones: hay que volver a consultar el lote. */
  readonly resync: boolean;
}

/**
 * Aplica una actualización pública al lote que se muestra. Es una función pura: el estado definitivo
 * lo decide siempre el backend, esto solo evita esperar a la siguiente consulta.
 */
export function applyLotUpdate(lot: LotWithAuction, update: LotUpdate): Applied {
  switch (update.__typename) {
    case 'BidPlacedUpdate': {
      // una actualización atrasada (menor o igual al precio vigente) no puede hacer retroceder el precio
      const stale =
        lot.currentPrice !== null && toCents(update.amount) <= toCents(lot.currentPrice);
      if (stale) return { lot, resync: false };
      return {
        lot: {
          ...lot,
          currentPrice: update.amount,
          nextMinimumBid: fromCents(toCents(update.amount) + toCents(lot.minIncrement)),
        },
        resync: false,
      };
    }
    case 'LotExtendedUpdate':
      return { lot: { ...lot, closesAt: update.newClosesAt }, resync: false };
    case 'LotClosedUpdate':
      return {
        lot: {
          ...lot,
          status: 'CLOSED',
          hasWinner: update.hasWinner,
          finalAmount: update.finalAmount,
        },
        resync: false,
      };
    case 'ResyncRequired':
      return { lot, resync: true };
    case 'LotPublishedUpdate':
      return { lot, resync: false };
  }
}
