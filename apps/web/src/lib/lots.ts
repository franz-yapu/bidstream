import type { Lot, LotBrief } from '../api/types';
import { formatMoney } from './money';

export type LotOrder = 'closing' | 'priceAsc' | 'priceDesc';

export const LOT_ORDERS: readonly { id: LotOrder; label: string }[] = [
  { id: 'closing', label: 'Cierran antes' },
  { id: 'priceAsc', label: 'Precio: de menor a mayor' },
  { id: 'priceDesc', label: 'Precio: de mayor a menor' },
];

/** Precio que se muestra de un lote: el final si cerró, si no el vigente o el de salida. */
export function lotPrice(
  lot: Pick<LotBrief, 'status' | 'finalAmount' | 'currentPrice' | 'startingPrice'>,
): number {
  const text =
    lot.status === 'CLOSED' && lot.finalAmount !== null
      ? lot.finalAmount
      : (lot.currentPrice ?? lot.startingPrice);
  return Number(text);
}

/** Copia ordenada; en empate manda el cierre más próximo y después el id, para que sea estable. */
export function sortLots<T extends Lot>(lots: readonly T[], order: LotOrder): T[] {
  const byClose = (a: T, b: T): number => Date.parse(a.closesAt) - Date.parse(b.closesAt);
  const compare = (a: T, b: T): number => {
    if (order === 'priceAsc') return lotPrice(a) - lotPrice(b);
    if (order === 'priceDesc') return lotPrice(b) - lotPrice(a);
    return byClose(a, b);
  };
  return [...lots].sort((a, b) => compare(a, b) || byClose(a, b) || a.id.localeCompare(b.id));
}

export interface AuctionSummary {
  readonly total: number;
  readonly open: number;
  /** Cierre más próximo entre los lotes abiertos (ISO) o null. */
  readonly nextClose: string | null;
  /** Precio más alto entre los lotes abiertos, ya con formato, o null. */
  readonly topPrice: string | null;
}

export function summarizeLots(lots: readonly LotBrief[]): AuctionSummary {
  const open = lots.filter((l) => l.status === 'OPEN');
  const nextClose =
    open.map((l) => l.closesAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  const top = [...open].sort((a, b) => lotPrice(b) - lotPrice(a))[0];
  return {
    total: lots.length,
    open: open.length,
    nextClose,
    topPrice:
      top === undefined ? null : formatMoney(top.currentPrice ?? top.startingPrice, top.currency),
  };
}
