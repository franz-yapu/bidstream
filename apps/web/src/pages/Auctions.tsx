import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import type { Auction, AuctionStatus } from '../api/types';
import { useApi } from '../auth/context';
import { EmptyState } from '../components/EmptyState';
import { ErrorNote } from '../components/ErrorNote';
import { ArrowRight } from '../components/icons';
import { Skeleton } from '../components/Skeleton';
import { StatusBadge } from '../components/StatusBadge';
import { formatDateTime, useServerNow } from '../lib/time';

type Tab = 'live' | 'soon' | 'closed' | 'all';

const TABS: readonly { id: Tab; label: string; status: AuctionStatus | null }[] = [
  { id: 'live', label: 'En curso', status: 'OPEN' },
  { id: 'soon', label: 'Próximas', status: 'OPEN' },
  { id: 'closed', label: 'Finalizadas', status: 'CLOSED' },
  { id: 'all', label: 'Todas', status: null },
];

const EMPTY: Record<Tab, string> = {
  live: 'No hay subastas en curso ahora mismo.',
  soon: 'No hay subastas programadas.',
  closed: 'Todavía no ha terminado ninguna subasta.',
  all: 'Todavía no hay subastas.',
};

export function AuctionsPage() {
  const api = useApi();
  const [tab, setTab] = useState<Tab>('live');
  const status = TABS.find((t) => t.id === tab)?.status ?? null;
  const query = useInfiniteQuery({
    queryKey: ['auctions', status],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.listAuctions({ after: pageParam, status }),
    getNextPageParam: (last) => (last.hasNextPage ? last.endCursor : undefined),
  });
  const now = useServerNow(api.clock.offsetMs);
  const started = (a: Auction): boolean => Date.parse(a.opensAt) <= now;
  const all = query.data?.pages.flatMap((page) => page.items) ?? [];
  const auctions = all.filter((a) =>
    tab === 'live' ? started(a) : tab === 'soon' ? !started(a) : true,
  );

  return (
    <section className="pt-6">
      <h1 className="rise text-5xl sm:text-6xl">Subastas</h1>
      <p
        className="rise mt-3 max-w-xl text-lg text-ink-soft"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        Elige una para ver sus lotes, el precio en vivo y quién va ganando.
      </p>

      <div role="tablist" aria-label="Filtrar subastas" className="mt-8 mb-8 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
            }}
            className={`rounded-full px-4 py-2 text-[15px] font-medium transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] ${tab === t.id ? 'bg-ink text-paper' : 'bg-sand text-ink [@media(hover:hover)]:hover:bg-sand-deep'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {query.isPending && (
        <div role="status" aria-label="Cargando subastas" className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      )}
      <ErrorNote error={query.error} />
      {query.isSuccess && auctions.length === 0 && <EmptyState title={EMPTY[tab]} />}

      <ul className="grid gap-4 sm:grid-cols-2">
        {auctions.map((auction, i) => (
          <li
            key={auction.id}
            className="rise"
            style={{ '--i': Math.min(i, 6) } as React.CSSProperties}
          >
            <Link
              to={`/subastas/${auction.id}`}
              className="card-link group flex h-full flex-col gap-4"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-3xl leading-tight">{auction.title}</h2>
                <StatusBadge status={auction.status} upcoming={!started(auction)} />
              </div>
              <p className="mt-auto flex items-center justify-between gap-3 text-[15px] text-ink-soft">
                <span>
                  {formatDateTime(auction.opensAt)} → {formatDateTime(auction.closesAt)}
                </span>
                <ArrowRight className="shrink-0 text-forest transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
              </p>
            </Link>
          </li>
        ))}
      </ul>

      {query.hasNextPage && (
        <div className="mt-8 text-center">
          <button
            type="button"
            className="btn-secondary"
            disabled={query.isFetchingNextPage}
            onClick={() => {
              void query.fetchNextPage();
            }}
          >
            {query.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
          </button>
        </div>
      )}
    </section>
  );
}
