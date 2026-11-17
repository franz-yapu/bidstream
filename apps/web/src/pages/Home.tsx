import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import type { AuctionWithLiveLots, Lot } from '../api/types';
import { useApi, useMe } from '../auth/context';
import { Avatar } from '../components/Avatar';
import { Countdown } from '../components/Countdown';
import { Reveal } from '../components/Reveal';
import { Seal } from '../components/Seal';
import { EmptyState } from '../components/EmptyState';
import { ArrowRight, Check } from '../components/icons';
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
    title: 'Mira sin cuenta',
    text: 'Entra, elige un lote y ve el precio vigente, quién va ganando y cuánto falta. Nadie te pide nada para mirar.',
    tags: ['Precio en vivo', 'Quién gana', 'Cuenta atrás'],
  },
  {
    title: 'Crea tu cuenta',
    text: 'Un correo, un nombre público y una contraseña. El nombre es lo único que ven los demás: tu correo nunca se muestra.',
    tags: ['Nombre público', 'Correo privado'],
  },
  {
    title: 'Puja',
    text: 'Tu puja tiene que superar la actual por el incremento mínimo. Los atajos rellenan el importe; tú confirmas.',
    tags: ['Incremento mínimo', 'Atajos', 'Tiempo real'],
  },
  {
    title: 'Gana al cierre',
    text: 'Si nadie puja más antes de que se acabe el tiempo, el lote es tuyo. Una puja en los últimos minutos alarga el cierre.',
    tags: ['Cierre limpio', 'Cada puja queda registrada'],
  },
] as const;

const AUDIENCE = [
  {
    who: 'Espectadores',
    where: 'Sin cuenta',
    title: 'Sigue cualquier subasta como si estuvieras en la sala.',
    points: [
      'Precio, líder y tiempo restante, actualizados solos',
      'El historial de pujas con el nombre de cada postor',
      'Un enlace para compartir cada lote',
    ],
  },
  {
    who: 'Postores',
    where: 'Con cuenta',
    title: 'Puja con claridad y sin sorpresas.',
    points: [
      'Te avisa si vas ganando o te han superado',
      'Importes rápidos desde el mínimo válido',
      'Tus pujas marcadas en cada historial',
    ],
  },
  {
    who: 'Vendedores',
    where: 'Con cuenta de vendedor',
    title: 'Publica subastas y lotes en minutos.',
    points: [
      'Crea la subasta y añade lotes con su precio de salida',
      'Cada lote cierra a su hora, con alargue automático',
      'Resultado público con el ganador y el precio final',
    ],
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
  const [audience, setAudience] = useState(0);

  const now = useServerNow(api.clock.offsetMs);
  const live = flatten(
    (open.data ?? []).filter((a) => Date.parse(a.opensAt) <= now),
    'OPEN',
  ).sort((a, b) => Date.parse(a.lot.closesAt) - Date.parse(b.lot.closesAt));
  const upcoming = (open.data ?? []).filter((a) => Date.parse(a.opensAt) > now);
  const results = flatten(closed.data ?? [], 'CLOSED')
    .filter((r) => r.lot.finalAmount !== null)
    .slice(0, 6);
  const next = live[0];
  const who = AUDIENCE[audience] ?? AUDIENCE[0];

  return (
    <>
      <section className="relative pt-8 pb-20 lg:pt-14 lg:pb-28">
        <div className="glow top-0 -right-24 h-[420px] w-[420px] bg-lime/40" aria-hidden="true" />
        <div
          className="glow -bottom-10 left-1/3 h-[300px] w-[300px] bg-forest/15"
          aria-hidden="true"
        />
        <div className="relative grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="eyebrow rise">Subastas en vivo · a la vista de todos</p>
            <h1 className="rise mt-6 text-[clamp(2.8rem,6.6vw,5.6rem)] leading-[0.98]">
              Subastas en vivo, <span className="accent-text">a la vista de todos.</span>
            </h1>
            <p
              className="rise mt-7 max-w-xl text-xl text-ink-soft"
              style={{ '--i': 1 } as React.CSSProperties}
            >
              Mira cómo sube el precio, quién va ganando y cuánto falta para el cierre. Cuando
              quieras entrar en la puja, solo necesitas una cuenta.
            </p>
            <div
              className="rise mt-9 flex flex-wrap gap-3"
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
            <p
              className="rise mt-6 text-[15px] text-ink-soft"
              style={{ '--i': 3 } as React.CSSProperties}
            >
              Mirar es libre · Para pujar necesitas cuenta
            </p>
          </div>

          <div
            className="rise relative mx-auto w-full max-w-[520px]"
            style={{ '--i': 2 } as React.CSSProperties}
          >
            <Seal className="w-full" />
            {open.isSuccess && next !== undefined && (
              <Link
                to={`/lotes/${next.lot.id}`}
                className="absolute -bottom-4 left-0 w-[78%] max-w-[300px] rounded-[16px] bg-paper p-4 shadow-[0_18px_40px_-18px_rgb(23_33_27/0.45)] transition-transform duration-200 ease-out [@media(hover:hover)]:hover:-translate-y-0.5"
              >
                <p className="flex items-center gap-2 text-[13px] font-medium text-forest">
                  <span className="live-dot" aria-hidden="true" /> Cierra primero
                </p>
                <p className="display mt-1 truncate text-xl">{next.lot.title}</p>
                <p className="mt-1 flex items-baseline justify-between gap-3">
                  <span className="display num text-2xl">
                    {formatMoney(
                      next.lot.currentPrice ?? next.lot.startingPrice,
                      next.lot.currency,
                    )}
                  </span>
                  <Countdown closesAt={next.lot.closesAt} className="text-[15px] text-ink-soft" />
                </p>
              </Link>
            )}
          </div>
        </div>

        <dl className="relative mt-16 grid grid-cols-3 gap-6 border-t border-sand-deep pt-8 text-center sm:text-left">
          <div>
            <dt className="eyebrow !hidden sm:!inline-flex">En proceso</dt>
            <dd className="display num mt-2 text-4xl sm:text-5xl">{live.length}</dd>
            <p className="text-[15px] text-ink-soft sm:hidden">En proceso</p>
          </div>
          <div>
            <dt className="eyebrow !hidden sm:!inline-flex">Próximas</dt>
            <dd className="display num mt-2 text-4xl sm:text-5xl">{upcoming.length}</dd>
            <p className="text-[15px] text-ink-soft sm:hidden">Próximas</p>
          </div>
          <div>
            <dt className="eyebrow !hidden sm:!inline-flex">Adjudicados</dt>
            <dd className="display num mt-2 text-4xl sm:text-5xl">{results.length}</dd>
            <p className="text-[15px] text-ink-soft sm:hidden">Adjudicados</p>
          </div>
        </dl>
      </section>

      <section
        aria-labelledby="en-vivo"
        className="bleed on-dark relative overflow-hidden bg-night py-20 text-paper"
      >
        <div
          className="glow -top-24 left-1/4 h-[380px] w-[380px] bg-forest/60"
          aria-hidden="true"
        />
        <div
          className="glow -right-20 bottom-0 h-[320px] w-[320px] bg-lime/20"
          aria-hidden="true"
        />
        <div className="relative">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <Reveal>
              <p className="eyebrow">En proceso ahora</p>
              <h2 id="en-vivo" className="mt-4 text-4xl sm:text-6xl">
                Lo que se puja <span className="accent-text">ahora mismo</span>
              </h2>
            </Reveal>
            <Link
              to="/lotes"
              className="inline-flex items-center gap-1.5 font-medium text-lime underline decoration-lime/40 underline-offset-4 hover:decoration-lime"
            >
              Ver todos los lotes <ArrowRight />
            </Link>
          </div>
          {open.isPending && <TicketSkeletons />}
          {open.isError && (
            <p role="alert" className="text-lime">
              No se pudieron cargar los lotes. Reintenta en unos segundos.
            </p>
          )}
          {live.length > 0 && (
            <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {live.slice(0, 6).map(({ lot, auctionTitle }, i) => (
                <li key={lot.id} className="flex">
                  <Reveal index={i} className="flex w-full">
                    <div className="flex w-full flex-col [&>div]:flex-1">
                      <LotTicket lot={lot} auctionTitle={auctionTitle} />
                    </div>
                  </Reveal>
                </li>
              ))}
            </ul>
          )}
          {open.isSuccess && live.length === 0 && (
            <EmptyState onDark title="Ahora mismo no hay lotes en curso">
              Cuando se abra una subasta, los lotes que cierren antes aparecerán aquí con su cuenta
              atrás.
            </EmptyState>
          )}

          {upcoming.length > 0 && (
            <div className="mt-16">
              <h3 className="mb-5 text-2xl text-paper/90">Próximas subastas</h3>
              <ul className="grid gap-4 md:grid-cols-2">
                {upcoming.map((a) => (
                  <li key={a.id}>
                    <Link
                      to={`/subastas/${a.id}`}
                      className="glass block rounded-[16px] p-6 transition-transform duration-200 ease-out active:scale-[0.99] [@media(hover:hover)]:hover:-translate-y-0.5"
                    >
                      <p className="display text-2xl">{a.title}</p>
                      <p className="mt-1 text-paper/75">Abre el {formatDateTime(a.opensAt)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section id="como-funciona" aria-labelledby="como" className="py-24">
        <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <Reveal>
              <p className="eyebrow">El recorrido</p>
              <h2 id="como" className="mt-4 text-4xl sm:text-6xl">
                Cómo funciona
              </h2>
              <p className="mt-5 max-w-md text-lg text-ink-soft">
                Cuatro momentos, un solo camino: de mirar una subasta a llevarte el lote.
              </p>
            </Reveal>
          </div>
          <ol className="relative space-y-12 border-l border-dashed border-sand-deep pl-8 sm:pl-12">
            {STEPS.map((step, i) => (
              <li key={step.title} className="relative">
                <Reveal index={i}>
                  <span
                    aria-hidden="true"
                    className="absolute top-3 -left-[calc(2rem+5px)] h-2.5 w-2.5 rounded-full bg-lime-deep sm:-left-[calc(3rem+5px)]"
                  />
                  <div className="flex items-start gap-6">
                    <span
                      aria-hidden="true"
                      className={`outline-num text-[clamp(3.5rem,8vw,5.5rem)] ${i === 0 ? 'is-on' : ''}`}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <h3 className="text-3xl">{step.title}</h3>
                      <p className="mt-2 text-ink-soft">{step.text}</p>
                      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] font-semibold tracking-[0.12em] text-forest uppercase">
                        {step.tags.map((t) => (
                          <li key={t} className="flex items-center gap-2">
                            <span
                              className="h-1 w-1 rounded-full bg-lime-deep"
                              aria-hidden="true"
                            />
                            {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="para-quien" className="bleed bg-paper py-24">
        <Reveal>
          <p className="eyebrow">Para quién es</p>
          <h2 id="para-quien" className="mt-4 mb-12 max-w-2xl text-4xl sm:text-6xl">
            Cada persona, <span className="accent-text">su propio espacio</span>
          </h2>
        </Reveal>
        <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
          <div role="tablist" aria-label="Para quién" className="border-t border-sand-deep">
            {AUDIENCE.map((a, i) => (
              <button
                key={a.who}
                type="button"
                role="tab"
                id={`aud-${String(i)}`}
                aria-selected={audience === i}
                aria-controls="aud-panel"
                onClick={() => {
                  setAudience(i);
                }}
                className={`flex w-full items-baseline gap-4 border-b border-sand-deep py-5 text-left transition-colors duration-150 ${audience === i ? 'text-ink' : 'text-ink-soft [@media(hover:hover)]:hover:text-ink'}`}
              >
                <span className="num text-[13px] font-semibold text-forest">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span>
                  <span className="display block text-4xl">{a.who}</span>
                  <span className="text-[15px] text-ink-soft">{a.where}</span>
                </span>
              </button>
            ))}
          </div>
          <div
            id="aud-panel"
            role="tabpanel"
            aria-labelledby={`aud-${String(audience)}`}
            className="rounded-[24px] bg-forest-tint p-8 sm:p-10"
          >
            <h3 className="text-3xl leading-tight sm:text-4xl">{who.title}</h3>
            <ul className="mt-8 space-y-4">
              {who.points.map((point) => (
                <li key={point} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-forest text-paper"
                  >
                    <Check />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section aria-labelledby="finalizadas" className="py-24">
        <Reveal>
          <p className="eyebrow">Resultados</p>
          <h2 id="finalizadas" className="mt-4 mb-10 text-4xl sm:text-6xl">
            Finalizadas
          </h2>
        </Reveal>
        {closed.isPending && <TicketSkeletons count={2} />}
        {closed.isSuccess && results.length === 0 && (
          <EmptyState title="Todavía no hay resultados">
            Los lotes que se cierren con ganador aparecerán aquí con su precio final.
          </EmptyState>
        )}
        {results.length > 0 && (
          <ul className="overflow-hidden rounded-[16px] bg-paper">
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

      <section
        aria-labelledby="cierre"
        className="bleed on-dark relative -mb-20 overflow-hidden bg-forest-deep py-24 text-paper"
      >
        <div className="glow top-0 left-1/3 h-[360px] w-[360px] bg-lime/25" aria-hidden="true" />
        <svg
          viewBox="0 0 1200 220"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-40 w-full"
        >
          <path
            d="M0 200 L140 140 L260 175 L420 80 L520 130 L640 60 L780 150 L900 100 L1040 160 L1200 110 V220 H0 Z"
            fill="#1e4a38"
            opacity="0.55"
          />
          <path
            d="M0 200 L140 140 L260 175 L420 80 L520 130 L640 60 L780 150 L900 100 L1040 160 L1200 110"
            fill="none"
            stroke="#b6d96c"
            strokeOpacity="0.6"
            strokeWidth="1.5"
          />
        </svg>
        <Reveal className="relative">
          <p className="eyebrow on-dark">Tu turno</p>
          <h2 id="cierre" className="mt-4 max-w-3xl text-4xl sm:text-6xl">
            {me === null ? '¿Listo para pujar?' : 'Hay lotes esperando tu puja'}
          </h2>
          <p className="mt-5 max-w-xl text-lg text-paper/80">
            {me === null
              ? 'Crea tu cuenta en un minuto. Si ya tienes una, entra con tu correo y tu contraseña.'
              : 'Elige un lote en proceso y haz tu primera puja.'}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {me === null ? (
              <>
                <Link
                  to="/entrar?modo=registro"
                  className="btn !bg-lime !text-night [@media(hover:hover)]:hover:!bg-paper"
                >
                  Crear cuenta <ArrowRight />
                </Link>
                <Link to="/entrar" className="btn-secondary !bg-white/10 !text-paper">
                  Entrar
                </Link>
              </>
            ) : (
              <Link to="/lotes" className="btn !bg-lime !text-night">
                Ver lotes en proceso <ArrowRight />
              </Link>
            )}
          </div>
        </Reveal>
      </section>
    </>
  );
}
