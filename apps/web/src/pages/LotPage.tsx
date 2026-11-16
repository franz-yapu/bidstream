import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useApi, useMe } from '../auth/context';
import { Avatar } from '../components/Avatar';
import { BidForm } from '../components/BidForm';
import { EmptyState } from '../components/EmptyState';
import { ErrorNote } from '../components/ErrorNote';
import { ArrowRight } from '../components/icons';
import { LivePrice } from '../components/LivePrice';
import { Skeleton } from '../components/Skeleton';
import { StatusBadge } from '../components/StatusBadge';
import { formatMoney } from '../lib/money';
import { formatCountdown, formatDateTime, useCountdown } from '../lib/time';
import { useLiveLot } from './useLiveLot';

/** El color avisa de la urgencia sin depender solo de él: el tiempo restante siempre se lee. */
function urgencyClass(ms: number): string {
  if (ms <= 60_000) return 'text-crimson';
  if (ms <= 300_000) return 'text-forest';
  return '';
}

function urgencyNote(ms: number): string | null {
  if (ms <= 0) return null;
  if (ms <= 60_000) return 'Último minuto: una puja ahora alarga el cierre.';
  if (ms <= 300_000) return 'Quedan pocos minutos.';
  return null;
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

  if (query.isPending) {
    return (
      <div
        role="status"
        aria-label="Cargando lote"
        className="grid gap-4 pt-8 lg:grid-cols-[1.5fr_1fr]"
      >
        <Skeleton className="h-96" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (query.isError) return <ErrorNote error={query.error} />;
  if (lot == null)
    return (
      <div role="alert" className="pt-8">
        <EmptyState title="No se encontró el lote">
          Puede que el enlace esté mal o que el lote aún no se haya publicado.
        </EmptyState>
      </div>
    );

  const closed = lot.status === 'CLOSED';
  const timeUp = remaining === 0;
  const top = bids.data?.items[0];
  // el líder sale de la puja mejor clasificada (la misma lista que se ve), no de una consulta aparte
  const leaderName = closed
    ? (lot.winner?.displayName ?? null)
    : (top?.bidder?.displayName ?? lot.leader?.displayName ?? null);
  const note = closed ? null : urgencyNote(remaining);
  const volver = encodeURIComponent(`/lotes/${lotId}`);

  return (
    <section className="pt-4">
      <Link
        to={lot.auction === null ? '/subastas' : `/subastas/${lot.auction.id}`}
        className="link inline-flex items-center gap-1.5"
      >
        <ArrowRight className="rotate-180" /> {lot.auction?.title ?? 'Subastas'}
      </Link>
      <div className="mt-4 mb-8 flex flex-wrap items-center gap-x-5 gap-y-2">
        <h1 className="rise text-5xl leading-[1.04] sm:text-6xl">{lot.title}</h1>
        <StatusBadge status={lot.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] lg:items-start">
        <div className="ticket rise" style={{ '--i': 1 } as React.CSSProperties}>
          <div className="p-6 sm:p-9">
            <p className="text-[15px] text-ink-soft">
              {closed
                ? lot.hasWinner
                  ? 'Precio final'
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
            <p className="mt-3 flex items-center gap-2 text-lg" aria-live="polite">
              {leaderName !== null ? (
                <>
                  <Avatar name={leaderName} size={32} />
                  <span>
                    {closed ? 'Ganó' : 'Va ganando'}{' '}
                    <strong className="font-semibold">{leaderName}</strong>
                  </span>
                </>
              ) : (
                <span className="text-ink-soft">
                  {closed ? 'Nadie pujó por este lote.' : 'Todavía nadie ha pujado: sé el primero.'}
                </span>
              )}
            </p>
          </div>

          <div className="ticket-stub !block !px-6 !py-6 sm:!px-9">
            {!closed && (
              <div className="mb-6">
                <p className="text-[15px] text-ink-soft">Tiempo restante</p>
                <p
                  data-testid="countdown"
                  role="timer"
                  className={`display num text-5xl ${urgencyClass(remaining)}`}
                >
                  {timeUp ? 'Cerrando…' : formatCountdown(remaining)}
                </p>
                {note !== null && <p className="mt-1 text-[15px] text-ink-soft">{note}</p>}
              </div>
            )}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
              <div>
                <dt className="text-[15px] text-ink-soft">Precio de salida</dt>
                <dd className="num font-medium">{formatMoney(lot.startingPrice, lot.currency)}</dd>
              </div>
              <div>
                <dt className="text-[15px] text-ink-soft">Incremento mínimo</dt>
                <dd className="num font-medium">{formatMoney(lot.minIncrement, lot.currency)}</dd>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <dt className="text-[15px] text-ink-soft">
                  {closed ? 'Cerró' : 'Cierre previsto'}
                </dt>
                <dd className="font-medium">{formatDateTime(lot.closesAt)}</dd>
              </div>
            </dl>
          </div>
        </div>

        <aside className="rise" style={{ '--i': 2 } as React.CSSProperties}>
          {me?.role === 'BIDDER' ? (
            <div className="card">
              <h2 className="mb-4 text-2xl">Hacer una puja</h2>
              <BidForm lot={lot} closed={closed || timeUp} />
            </div>
          ) : me === null ? (
            <div className="card">
              <h2 className="text-2xl">Entra para pujar</h2>
              <p className="mt-2 text-ink-soft">
                Puedes seguir este lote sin cuenta. Para pujar, entra o crea una: volverás aquí.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link to={`/entrar?volver=${volver}`} className="btn">
                  Entrar
                </Link>
                <Link to={`/entrar?modo=registro&volver=${volver}`} className="btn-secondary">
                  Crear cuenta
                </Link>
              </div>
            </div>
          ) : (
            <p className="text-ink-soft">Solo los postores pueden pujar.</p>
          )}
        </aside>
      </div>

      <h2 className="mt-14 mb-5 text-3xl">Historial de pujas</h2>
      <ErrorNote error={bids.error} />
      {bids.data?.items.length === 0 && (
        <EmptyState title="Aún no hay pujas">La primera puja marcará el ritmo del lote.</EmptyState>
      )}
      {bids.data !== undefined && bids.data.items.length > 0 && (
        <ol className="overflow-hidden rounded-[16px] bg-paper">
          {bids.data.items.map((bid) => {
            const name = bid.bidder?.displayName ?? 'Postor';
            return (
              <li
                key={bid.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b-4 border-dotted border-ground px-5 py-4 last:border-b-0 sm:px-6"
              >
                <Avatar name={name} />
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{name}</span>
                  {bid.rank === 1 && !closed && (
                    <span className="badge bg-forest text-paper">Vigente</span>
                  )}
                  {bid.awarded && (
                    <span className="badge bg-forest-tint text-forest">Adjudicada</span>
                  )}
                </span>
                <span className="display num text-2xl">
                  {formatMoney(bid.amount, lot.currency)}
                </span>
                <span className="w-full text-[14px] text-ink-soft sm:w-auto sm:min-w-40 sm:text-right">
                  {formatDateTime(bid.placedAt)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {bids.data?.hasNextPage === true && (
        <p className="mt-3 text-[15px] text-ink-soft">
          Se muestran las {String(bids.data.items.length)} mejores pujas.
        </p>
      )}
    </section>
  );
}
