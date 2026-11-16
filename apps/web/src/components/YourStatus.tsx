import type { Bid } from '../api/types';
import { formatMoney } from '../lib/money';
import { Check } from './icons';

/**
 * Cómo va el postor en este lote, según el historial público: va ganando, lo han superado (y cuánto
 * debe pujar ahora) o aún no ha pujado. Se reconoce por su nombre público, único por tenant.
 */
export function YourStatus({
  me,
  closed,
  bids,
  currency,
  nextMinimum,
}: {
  me: string;
  closed: boolean;
  bids: readonly Bid[];
  currency: string;
  nextMinimum: string;
}) {
  const mine = bids.filter((b) => b.bidder?.displayName === me);
  if (mine.length === 0) return null;
  const leading = bids[0]?.bidder?.displayName === me;

  if (closed) {
    return (
      <p role="status" className="mb-4 rounded-[12px] bg-sand px-4 py-3 text-[15px]">
        {leading ? 'Ganaste este lote.' : 'Pujaste en este lote, pero no lo ganaste.'}
      </p>
    );
  }
  return leading ? (
    <p
      role="status"
      className="mb-4 flex items-center gap-2 rounded-[12px] bg-forest-tint px-4 py-3 text-[15px] font-medium text-forest"
    >
      <Check /> Vas ganando con {formatMoney(bids[0]?.amount ?? '0.00', currency)}
    </p>
  ) : (
    <p role="status" className="mb-4 rounded-[12px] bg-sand px-4 py-3 text-[15px]">
      <strong className="font-semibold text-crimson">Te han superado.</strong> Para volver a ganar,
      puja al menos {formatMoney(nextMinimum, currency)}.
    </p>
  );
}
