import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { AuctionWithLiveLots, Lot } from '../api/types';
import { useApi, useMe } from '../auth/context';
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import { ArrowRight } from '../components/icons';
import { LotTicket } from '../components/LotTicket';
import { TicketSkeletons } from '../components/Skeleton';
import { formatMoney } from '../lib/money';
import { usePageTitle } from '../lib/page-title';
import { formatDateTime, useServerNow } from '../lib/time';

interface BoardLot {
  readonly lot: Lot;
  readonly auctionTitle: string;
}

const flatten = (auctions: readonly AuctionWithLiveLots[], status: Lot['status']): BoardLot[] =>
  auctions.flatMap((a) =>
    a.lots.filter((l) => l.status === status).map((lot) => ({ lot, auctionTitle: a.title })),
  );

const STEPS = [
  {
    title: 'Crea tu cuenta',
    text: 'Un correo, un nombre público y una contraseña. Mirar es libre; para pujar necesitas cuenta.',
  },
  {
    title: 'Elige un lote y puja',
    text: 'Ves el precio vigente y el tiempo que falta. Tu puja tiene que superar la actual por el incremento mínimo.',
  },
  {
    title: 'Gana al cierre',
    text: 'Si nadie puja más antes de que se acabe el tiempo, el lote es tuyo. Una puja en los últimos minutos alarga el cierre.',
  },
] as const;

export function HomePage() {
  usePageTitle(null);
  const api = useApi();
  const me = useMe();
  // el inicio se mantiene al día solo: precios, líderes y cierres
  const open = useQuery({
    queryKey: ['board', 'OPEN'],
    queryFn: () => api.board('OPEN'),
    refetchInterval: 8000,
  });
  const closed = useQuery({
    queryKey: ['board', 'CLOSED'],
    queryFn: () => api.board('CLOSED'),
    refetchInterval: 20_000,
  });

  const now = useServerNow(api.clock.offsetMs);
  const live = flatten(
    (open.data ?? []).filter((a) => Date.parse(a.opensAt) <= now),
    'OPEN',
  ).sort((a, b) => Date.parse(a.lot.closesAt) - Date.parse(b.lot.closesAt));
  const upcoming = (open.data ?? []).filter((a) => Date.parse(a.opensAt) > now);
  const results = flatten(closed.data ?? [], 'CLOSED')
    .filter((r) => r.lot.finalAmount !== null)
    .slice(0, 6);

  return (
    <>
      <section className="grid items-center gap-10 pt-6 pb-16 lg:grid-cols-[1.05fr_1fr] lg:pt-12">
        <div>
          <h1 className="rise text-[clamp(2.6rem,6.2vw,5rem)] leading-[1.02]">
            Subastas en vivo, a la vista de todos.
          </h1>
          <p
            className="rise mt-6 max-w-xl text-xl text-ink-soft"
            style={{ '--i': 1 } as React.CSSProperties}
          >
            Mira cómo sube el precio, quién va ganando y cuánto falta para el cierre. Cuando quieras
            entrar en la puja, solo necesitas una cuenta.
          </p>
          <div
            className="rise mt-8 flex flex-wrap gap-3"
            style={{ '--i': 2 } as React.CSSProperties}
          >
            <Link to="/subastas" className="btn">
              Ver subastas en curso
              <ArrowRight />
            </Link>
            {me === null && (
              <Link to="/entrar?modo=registro" className="btn-secondary">
                Crear cuenta
              </Link>
            )}
          </div>
        </div>

        <div className="rise" style={{ '--i': 2 } as React.CSSProperties}>
          {open.isPending ? (
            <TicketSkeletons count={1} />
          ) : live[0] !== undefined ? (
            <LotTicket lot={live[0].lot} auctionTitle={live[0].auctionTitle} featured />
          ) : (
            <EmptyState title="Ahora mismo no hay lotes en curso">
              Cuando se abra una subasta, el lote que cierre antes aparecerá aquí con su cuenta
              atrás.
            </EmptyState>
          )}
        </div>
      </section>

      <section aria-labelledby="en-vivo" className="py-16">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <h2 id="en-vivo" className="text-4xl sm:text-5xl">
            En vivo ahora
          </h2>
          <Link to="/subastas" className="link inline-flex items-center gap-1.5">
            Todas las subastas <ArrowRight />
          </Link>
        </div>
        {open.isPending && <TicketSkeletons />}
        {open.isError && (
          <p role="alert" className="error">
            No se pudieron cargar los lotes. Reintenta en unos segundos.
          </p>
        )}
        {live.length > 1 && (
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {live.slice(1, 7).map(({ lot, auctionTitle }, i) => (
              <li key={lot.id} className="rise flex" style={{ '--i': i } as React.CSSProperties}>
                <div className="flex w-full flex-col [&>a]:flex-1">
                  <LotTicket lot={lot} auctionTitle={auctionTitle} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {open.isSuccess && live.length <= 1 && (
          <p className="text-ink-soft">
            {live.length === 0
              ? 'No hay lotes abiertos todavía.'
              : 'Ese es el único lote en curso por ahora.'}
          </p>
        )}
      </section>

      {upcoming.length > 0 && (
        <section aria-labelledby="proximas" className="py-16">
          <h2 id="proximas" className="mb-8 text-4xl sm:text-5xl">
            Próximas subastas
          </h2>
          <ul className="grid gap-4 md:grid-cols-2">
            {upcoming.map((a) => (
              <li key={a.id}>
                <Link to={`/subastas/${a.id}`} className="card-link">
                  <p className="display text-2xl">{a.title}</p>
                  <p className="mt-1 text-ink-soft">Abre el {formatDateTime(a.opensAt)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        id="como-funciona"
        aria-labelledby="como"
        className="-mx-5 rounded-[28px] bg-forest px-5 py-14 text-paper sm:-mx-8 sm:px-10 lg:px-14"
      >
        <h2 id="como" className="max-w-2xl text-4xl sm:text-5xl">
          Cómo funciona
        </h2>
        <ol className="mt-10 grid gap-10 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rise" style={{ '--i': i } as React.CSSProperties}>
              <h3 className="text-3xl">{step.title}</h3>
              <p className="mt-3 text-paper/85">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="finalizadas" className="py-16 pt-20">
        <h2 id="finalizadas" className="mb-8 text-4xl sm:text-5xl">
          Finalizadas
        </h2>
        {closed.isPending && <TicketSkeletons count={2} />}
        {closed.isSuccess && results.length === 0 && (
          <EmptyState title="Todavía no hay resultados">
            Los lotes que se cierren con ganador aparecerán aquí con su precio final.
          </EmptyState>
        )}
        {results.length > 0 && (
          <ul className="divide-y-0 overflow-hidden rounded-[16px] bg-paper">
            {results.map(({ lot, auctionTitle }) => (
              <li key={lot.id} className="border-b-4 border-dotted border-ground last:border-b-0">
                <Link
                  to={`/lotes/${lot.id}`}
                  className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-5 transition-colors duration-150 [@media(hover:hover)]:hover:bg-white"
                >
                  <div className="min-w-0 flex-1">
                    <p className="display truncate text-2xl">{lot.title}</p>
                    <p className="text-[15px] text-ink-soft">{auctionTitle}</p>
                  </div>
                  {lot.winner && (
                    <p className="flex items-center gap-2 text-[15px]">
                      <Avatar name={lot.winner.displayName} size={30} />
                      Ganó {lot.winner.displayName}
                    </p>
                  )}
                  <p className="display num text-2xl">
                    {lot.finalAmount !== null ? formatMoney(lot.finalAmount, lot.currency) : ''}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
