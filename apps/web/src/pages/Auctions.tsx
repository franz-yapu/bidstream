import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import type { AuctionStatus } from '../api/types';
import { useApi } from '../auth/context';
import { ErrorNote } from '../components/ErrorNote';
import { StatusBadge } from '../components/StatusBadge';
import { formatDateTime } from '../lib/time';

export function AuctionsPage() {
  const api = useApi();
  const [status, setStatus] = useState<AuctionStatus | null>('OPEN');
  const query = useInfiniteQuery({
    queryKey: ['auctions', status],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.listAuctions({ after: pageParam, status }),
    getNextPageParam: (last) => (last.hasNextPage ? last.endCursor : undefined),
  });
  const auctions = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Subastas</h1>
        <label className="flex items-center gap-2 text-sm">
          Estado
          <select
            className="field w-auto"
            value={status ?? ''}
            onChange={(e) => {
              setStatus(e.target.value === '' ? null : (e.target.value as AuctionStatus));
            }}
          >
            <option value="OPEN">Abiertas</option>
            <option value="">Todas</option>
            <option value="CLOSED">Cerradas</option>
          </select>
        </label>
      </div>

      {query.isPending && <p role="status">Cargando subastas…</p>}
      <ErrorNote error={query.error} />
      {query.isSuccess && auctions.length === 0 && (
        <p className="card text-center opacity-80">
          {status === 'OPEN' ? 'No hay subastas abiertas ahora mismo.' : 'Todavía no hay subastas.'}
        </p>
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {auctions.map((auction) => (
          <li key={auction.id}>
            <Link to={`/subastas/${auction.id}`} className="card-link">
              <div className="mb-1 flex items-start justify-between gap-2">
                <h2 className="font-semibold">{auction.title}</h2>
                <StatusBadge status={auction.status} />
              </div>
              <p className="text-sm opacity-70">
                {formatDateTime(auction.opensAt)} → {formatDateTime(auction.closesAt)}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      {query.hasNextPage && (
        <div className="mt-4 text-center">
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
