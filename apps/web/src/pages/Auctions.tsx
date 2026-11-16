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
import { summarizeLots } from '../lib/lots';
import { usePageTitle } from '../lib/page-title';
import { formatDateTime, useServerNow } from '../lib/time';
import { Countdown } from '../components/Countdown';

type Tab = 'live' | 'soon' | 'closed' | 'all';

const TABS: readonly { id: Tab; label: string; status: AuctionStatus | null }[] = [
  { id: 'all', label: 'Todas', status: null },
  { id: 'live', label: 'En proceso', status: 'OPEN' },
  { id: 'soon', label: 'Próximas', status: 'OPEN' },
  { id: 'closed', label: 'Terminadas', status: 'CLOSED' },
];

const EMPTY: Record<Tab, string> = {
  live: 'No hay subastas en proceso ahora mismo.',
  soon: 'No hay subastas programadas.',
  closed: 'Todavía no ha terminado ninguna subasta.',
  all: 'Todavía no hay subastas.',
};

export function AuctionsPage() {
  usePageTitle('Subastas');
  const api = useApi();
  const [tab, setTab] = useState<Tab>('all');
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

      {tab === 'all' ? (
        <div className="space-y-12">
          <AuctionGroup
            title="En proceso"
            live
            auctions={auctions.filter((a) => a.status === 'OPEN' && started(a))}
            started={started}
          />
          <AuctionGroup
            title="Próximas"
            auctions={auctions.filter((a) => a.status === 'OPEN' && !started(a))}
            started={started}
          />
          <AuctionGroup
            title="Terminadas"
            muted
            auctions={auctions.filter((a) => a.status === 'CLOSED')}
            started={started}
          />
        </div>
      ) : (
        <AuctionList auctions={auctions} started={started} />
      )}

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

/** Qué hay dentro de la subasta: cuántos lotes, el precio más alto y cuándo cierra el próximo. */
function AuctionFacts({ auction, live }: { auction: Auction; live: boolean }) {
  if (auction.lots === undefined) return null;
  const s = summarizeLots(auction.lots);
  if (s.total === 0) return <p className="text-[15px] text-ink-soft">Aún sin lotes</p>;
  const more = s.total >= 10 ? '+' : '';
  return (
    <dl className="grid grid-cols-3 gap-3 text-[15px]">
      <div>
        <dt className="text-ink-soft">Lotes</dt>
        <dd className="num font-medium">
          {s.total}
          {more}
          {auction.status === 'OPEN' && s.open > 0 && s.open < s.total
            ? ` (${String(s.open)} abiertos)`
            : ''}
        </dd>
      </div>
      <div>
        <dt className="text-ink-soft">Precio más alto</dt>
        <dd className="num font-medium">{s.topPrice ?? '—'}</dd>
      </div>
      <div>
        <dt className="text-ink-soft">
          {live && s.nextClose !== null ? 'Próximo cierre' : 'Estado'}
        </dt>
        <dd className="font-medium">
          {live && s.nextClose !== null ? (
            <Countdown closesAt={s.nextClose} />
          ) : auction.status === 'CLOSED' ? (
            'Terminada'
          ) : live ? (
            'Sin lotes abiertos'
          ) : (
            'Próximamente'
          )}
        </dd>
      </div>
    </dl>
  );
}

function AuctionGroup({
  title,
  auctions,
  started,
  live = false,
  muted = false,
}: {
  title: string;
  auctions: readonly Auction[];
  started: (a: Auction) => boolean;
  live?: boolean;
  muted?: boolean;
}) {
  if (auctions.length === 0) return null;
  return (
    <section aria-label={title}>
      <h2 className={`mb-5 flex items-center gap-3 text-3xl ${muted ? 'text-ink-soft' : ''}`}>
        {live && <span className="live-dot text-forest" aria-hidden="true" />}
        {title} <span className="num text-ink-soft">{auctions.length}</span>
      </h2>
      <AuctionList auctions={auctions} started={started} />
    </section>
  );
}

function AuctionList({
  auctions,
  started,
}: {
  auctions: readonly Auction[];
  started: (a: Auction) => boolean;
}) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {auctions.map((auction, i) => {
        const closed = auction.status === 'CLOSED';
        return (
          <li
            key={auction.id}
            className="rise"
            style={{ '--i': Math.min(i, 6) } as React.CSSProperties}
          >
            <Link
              to={`/subastas/${auction.id}`}
              className={`card-link group flex h-full flex-col gap-4 ${closed ? 'bg-sand/70' : 'border-t-[5px] border-forest'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-3xl leading-tight">{auction.title}</h3>
                <StatusBadge status={auction.status} upcoming={!started(auction)} feminine />
              </div>
              <AuctionFacts auction={auction} live={started(auction)} />
              <p className="mt-auto flex items-center justify-between gap-3 text-[15px] text-ink-soft">
                <span>
                  {formatDateTime(auction.opensAt)} → {formatDateTime(auction.closesAt)}
                </span>
                <ArrowRight className="shrink-0 text-forest transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
