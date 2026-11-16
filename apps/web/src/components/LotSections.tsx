import type { Lot } from '../api/types';
import { sortLots, type LotOrder } from '../lib/lots';
import { LotTicket } from './LotTicket';

function Grid({
  lots,
  showBids,
  titles,
}: {
  lots: readonly Lot[];
  showBids: boolean;
  titles?: ReadonlyMap<string, string> | undefined;
}) {
  return (
    <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {lots.map((lot, i) => (
        <li
          key={lot.id}
          className="rise flex"
          style={{ '--i': Math.min(i, 6) } as React.CSSProperties}
        >
          <div className="flex w-full flex-col [&>div]:flex-1">
            <LotTicket lot={lot} auctionTitle={titles?.get(lot.id)} showBids={showBids} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Los lotes en dos bloques con título y cuenta: primero lo que está en proceso y debajo lo que ya
 * terminó (más reciente primero), para distinguirlos de un vistazo.
 */
export function LotSections({
  lots,
  order,
  showBids = false,
  titles,
}: {
  lots: readonly Lot[];
  order: LotOrder;
  showBids?: boolean;
  titles?: ReadonlyMap<string, string>;
}) {
  const live = sortLots(
    lots.filter((l) => l.status === 'OPEN'),
    order,
  );
  const done = sortLots(
    lots.filter((l) => l.status === 'CLOSED'),
    order,
  );
  if (order === 'closing') done.reverse();
  return (
    <div className="space-y-12">
      {live.length > 0 && (
        <section aria-labelledby="lots-live">
          <h2 id="lots-live" className="mb-5 flex items-center gap-3 text-3xl">
            <span className="live-dot text-forest" aria-hidden="true" />
            En proceso <span className="num text-ink-soft">{live.length}</span>
          </h2>
          <Grid lots={live} showBids={showBids} titles={titles} />
        </section>
      )}
      {done.length > 0 && (
        <section aria-labelledby="lots-done">
          <h2 id="lots-done" className="mb-5 text-3xl text-ink-soft">
            Terminados <span className="num">{done.length}</span>
          </h2>
          <Grid lots={done} showBids={showBids} titles={titles} />
        </section>
      )}
    </div>
  );
}
