import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useApi, useMe } from '../auth/context';
import { BidForm } from '../components/BidForm';
import { LivePrice } from '../components/LivePrice';
import { ErrorNote } from '../components/ErrorNote';
import { StatusBadge } from '../components/StatusBadge';
import { formatMoney } from '../lib/money';
import { formatCountdown, formatDateTime, useCountdown } from '../lib/time';
import { useLiveLot } from './useLiveLot';

/** El color avisa de la urgencia sin depender solo de él: el tiempo restante siempre se lee. */
function urgencyClass(ms: number): string {
  if (ms <= 60_000) return 'text-red-600 dark:text-red-400';
  if (ms <= 300_000) return 'text-amber-600 dark:text-amber-400';
  return '';
}

export function LotPage() {
  const { lotId = '' } = useParams();
  const api = useApi();
  const me = useMe();
  const query = useLiveLot(lotId);
  const lot = query.data;
  const bids = useQuery({
    queryKey: ['bids', lotId],
    queryFn: () => api.getBids(lotId),
    enabled: lot != null,
    // la proyección de pujas llega un instante después del aviso en vivo: se refresca sola
    refetchInterval: 4000,
  });
  const remaining = useCountdown(lot?.closesAt ?? new Date(0).toISOString(), api.clock.offsetMs);

  if (query.isPending) return <p role="status">Cargando…</p>;
  if (query.isError) return <ErrorNote error={query.error} />;
  if (lot == null)
    return (
      <p role="alert" className="card text-center">
        No se encontró el lote.
      </p>
    );

  const closed = lot.status === 'CLOSED';
  const timeUp = remaining === 0;

  return (
    <section>
      <Link
        to={lot.auction === null ? '/' : `/subastas/${lot.auction.id}`}
        className="text-sm underline opacity-80"
      >
        ← {lot.auction?.title ?? 'Subastas'}
      </Link>
      <div className="mt-2 mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{lot.title}</h1>
        <StatusBadge status={lot.status} />
      </div>

      <div className={me?.role === 'BIDDER' ? 'grid gap-4 md:grid-cols-[2fr_1fr]' : 'grid gap-4'}>
        <div className="card">
          <p className="text-sm opacity-70">
            {closed
              ? lot.hasWinner
                ? 'Adjudicado por'
                : 'Cerrado sin pujas'
              : lot.currentPrice === null
                ? 'Precio de salida'
                : 'Precio vigente'}
          </p>
          <LivePrice
            value={formatMoney(
              closed && lot.finalAmount !== null
                ? lot.finalAmount
                : (lot.currentPrice ?? lot.startingPrice),
              lot.currency,
            )}
          />
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="opacity-70">Incremento mínimo</dt>
              <dd>{formatMoney(lot.minIncrement, lot.currency)}</dd>
            </div>
            <div>
              <dt className="opacity-70">Cierre</dt>
              <dd>{formatDateTime(lot.closesAt)}</dd>
            </div>
            {!closed && (
              <div className="col-span-2">
                <dt className="opacity-70">Tiempo restante</dt>
                <dd
                  data-testid="countdown"
                  role="timer"
                  className={`text-2xl font-semibold tabular-nums ${urgencyClass(remaining)}`}
                >
                  {timeUp ? 'Cerrando…' : formatCountdown(remaining)}
                </dd>
              </div>
            )}
          </dl>
        </div>

        {me?.role === 'BIDDER' ? (
          <div className="card">
            <BidForm lot={lot} closed={closed || timeUp} />
          </div>
        ) : (
          <p className="text-sm opacity-80">Solo los postores pueden pujar.</p>
        )}
      </div>

      <h2 className="mt-8 mb-3 text-lg font-semibold">Pujas</h2>
      <ErrorNote error={bids.error} />
      {bids.data?.items.length === 0 && (
        <p className="card text-center opacity-80">Aún no hay pujas.</p>
      )}
      {bids.data !== undefined && bids.data.items.length > 0 && (
        <ol className="card divide-y divide-slate-200 p-0 dark:divide-slate-800">
          {bids.data.items.map((bid) => (
            <li key={bid.id} className="flex items-center justify-between px-5 py-3 text-sm">
              <span className="flex items-center gap-2 opacity-90">
                <span className="opacity-70">#{bid.rank}</span>
                {bid.rank === 1 && !closed && (
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                    Vigente
                  </span>
                )}
                {bid.awarded && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    Adjudicada
                  </span>
                )}
              </span>
              <span className="font-medium tabular-nums">
                {formatMoney(bid.amount, lot.currency)}
              </span>
              <span className="opacity-70">{formatDateTime(bid.placedAt)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
