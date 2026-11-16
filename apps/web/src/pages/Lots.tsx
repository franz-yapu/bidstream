import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Lot } from '../api/types';
import { useApi } from '../auth/context';
import { EmptyState } from '../components/EmptyState';
import { ErrorNote } from '../components/ErrorNote';
import { LotSort } from '../components/LotSort';
import { LotTicket } from '../components/LotTicket';
import { TicketSkeletons } from '../components/Skeleton';
import { sortLots, type LotOrder } from '../lib/lots';
import { usePageTitle } from '../lib/page-title';
import { useServerNow } from '../lib/time';

type Scope = 'OPEN' | 'CLOSED';

const SCOPES: readonly { id: Scope; label: string }[] = [
  { id: 'OPEN', label: 'Abiertos' },
  { id: 'CLOSED', label: 'Cerrados' },
];

export function LotsPage() {
  usePageTitle('Todos los lotes');
  const api = useApi();
  const [scope, setScope] = useState<Scope>('OPEN');
  const [order, setOrder] = useState<LotOrder>('closing');
  const query = useQuery({
    queryKey: ['lots-board', scope],
    queryFn: () => api.board(scope, { auctions: 12, lots: 12 }),
    refetchInterval: scope === 'OPEN' ? 8000 : 20_000,
  });
  const now = useServerNow(api.clock.offsetMs);

  const entries = (query.data ?? [])
    // una subasta que aún no abre no admite pujas: sus lotes no son «abiertos» todavía
    .filter((a) => scope === 'CLOSED' || Date.parse(a.opensAt) <= now)
    .flatMap((a) =>
      a.lots.filter((l) => l.status === scope).map((lot) => ({ lot, auctionTitle: a.title })),
    );
  const byId = new Map<string, string>(entries.map((e) => [e.lot.id, e.auctionTitle]));
  // cerrados: del más reciente al más antiguo, salvo que se pida otro orden por precio
  const sorted: Lot[] =
    scope === 'CLOSED' && order === 'closing'
      ? sortLots(
          entries.map((e) => e.lot),
          'closing',
        ).reverse()
      : sortLots(
          entries.map((e) => e.lot),
          order,
        );

  return (
    <section className="pt-6">
      <h1 className="rise text-5xl sm:text-6xl">Todos los lotes</h1>
      <p
        className="rise mt-3 max-w-xl text-lg text-ink-soft"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        Los lotes de todas las subastas en un solo sitio. Ordénalos por cierre o por precio.
      </p>

      <div className="mt-8 mb-8 flex flex-wrap items-center justify-between gap-4">
        <div role="tablist" aria-label="Estado de los lotes" className="flex gap-2">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={scope === s.id}
              onClick={() => {
                setScope(s.id);
              }}
              className={`rounded-full px-4 py-2 text-[15px] font-medium transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] ${scope === s.id ? 'bg-ink text-paper' : 'bg-sand text-ink [@media(hover:hover)]:hover:bg-sand-deep'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <LotSort value={order} onChange={setOrder} />
      </div>

      {query.isPending && <TicketSkeletons />}
      <ErrorNote error={query.error} />
      {query.isSuccess && sorted.length === 0 && (
        <EmptyState
          title={scope === 'OPEN' ? 'No hay lotes abiertos ahora' : 'Aún no hay lotes cerrados'}
        >
          Vuelve en un rato: la lista se actualiza sola.
        </EmptyState>
      )}
      <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sorted.map((lot, i) => (
          <li
            key={lot.id}
            className="rise flex"
            style={{ '--i': Math.min(i, 6) } as React.CSSProperties}
          >
            <div className="flex w-full flex-col [&>a]:flex-1">
              <LotTicket lot={lot} auctionTitle={byId.get(lot.id)} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
