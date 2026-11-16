import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import { z } from 'zod';
import { CREATOR_ROLES, useApi, useMe } from '../auth/context';
import { ArrowRight } from '../components/icons';
import { EmptyState } from '../components/EmptyState';
import { ErrorNote } from '../components/ErrorNote';
import { BidsSwitch } from '../components/BidsSwitch';
import { LotSections } from '../components/LotSections';
import { TicketSkeletons } from '../components/Skeleton';
import { StatusBadge } from '../components/StatusBadge';
import { parseMoneyInput } from '../lib/money';
import { type LotOrder } from '../lib/lots';
import { usePageTitle } from '../lib/page-title';
import { formatDateTime, useServerNow } from '../lib/time';
import { CopyLink } from '../components/CopyLink';
import { LotSort } from '../components/LotSort';

export function AuctionDetailPage() {
  const { auctionId = '' } = useParams();
  const api = useApi();
  const me = useMe();
  const query = useQuery({
    queryKey: ['auction', auctionId],
    queryFn: () => api.getAuction(auctionId),
    // la proyección es eventualmente consistente: una subasta recién creada tarda un instante
    refetchInterval: 4000,
  });
  const now = useServerNow(api.clock.offsetMs);
  const [adding, setAdding] = useState(false);
  const [order, setOrder] = useState<LotOrder>('closing');
  const [showBids, setShowBids] = useState(false);
  const auction = query.data;
  usePageTitle(auction?.title);
  const canCreate = me !== null && CREATOR_ROLES.includes(me.role);

  if (query.isPending) return <TicketSkeletons />;
  if (query.isError) return <ErrorNote error={query.error} />;
  if (auction == null) {
    return (
      <div role="status">
        <EmptyState title="La subasta todavía no aparece">
          Se actualizará sola en unos segundos…
        </EmptyState>
      </div>
    );
  }
  const upcoming = Date.parse(auction.opensAt) > now;

  return (
    <section className="pt-4">
      <Link to="/subastas" className="link inline-flex items-center gap-1.5">
        <ArrowRight className="rotate-180" /> Subastas
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <h1 className="text-5xl sm:text-6xl">{auction.title}</h1>
        <StatusBadge status={auction.status} upcoming={upcoming} feminine />
      </div>
      <div className="mt-3 mb-10 flex flex-wrap items-center justify-between gap-4">
        <p className="text-ink-soft">
          {formatDateTime(auction.opensAt)} → {formatDateTime(auction.closesAt)}
        </p>
        <CopyLink />
      </div>

      <div className="mb-6 flex items-center justify-between gap-3">
        <h2 className="text-3xl">Lotes</h2>
        {auction.lots.length > 1 && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <BidsSwitch checked={showBids} onChange={setShowBids} />
            <LotSort value={order} onChange={setOrder} />
          </div>
        )}
        {canCreate && auction.status === 'OPEN' && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setAdding((v) => !v);
            }}
          >
            {adding ? 'Cancelar' : 'Añadir lote'}
          </button>
        )}
      </div>

      {adding && (
        <AddLotForm
          auctionId={auction.id}
          onDone={() => {
            setAdding(false);
          }}
        />
      )}

      {auction.lots.length === 0 ? (
        <EmptyState title="Esta subasta aún no tiene lotes">
          {canCreate ? 'Añade el primero con «Añadir lote».' : 'Vuelve en un rato.'}
        </EmptyState>
      ) : (
        <LotSections lots={auction.lots} order={order} showBids={showBids} />
      )}
    </section>
  );
}

const money = z.string().transform((v, ctx) => {
  const parsed = parseMoneyInput(v);
  if (parsed === null) {
    ctx.addIssue({ code: 'custom', message: 'Importe positivo con hasta 2 decimales' });
    return z.NEVER;
  }
  return parsed;
});

const lotSchema = z.object({
  title: z.string().trim().min(1, 'Escribe un título').max(200),
  startingPrice: money,
  minIncrement: money,
  currency: z.string().regex(/^[A-Z]{3}$/, 'Tres letras mayúsculas (USD)'),
  closesAt: z.string().min(1, 'Elige cuándo cierra'),
});
type LotInput = z.input<typeof lotSchema>;
type LotValues = z.output<typeof lotSchema>;

function AddLotForm({ auctionId, onDone }: { auctionId: string; onDone: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LotInput, unknown, LotValues>({
    resolver: zodResolver(lotSchema),
    defaultValues: { currency: 'USD' },
  });
  const create = useMutation({
    mutationFn: (v: LotValues) =>
      api.createLot(auctionId, {
        title: v.title,
        startingPrice: v.startingPrice,
        minIncrement: v.minIncrement,
        currency: v.currency,
        closesAt: new Date(v.closesAt).toISOString(),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auction', auctionId] });
      onDone();
    },
  });

  return (
    <form
      noValidate
      className="card mb-8 grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        void handleSubmit((v) => create.mutateAsync(v).catch(() => undefined))(e);
      }}
    >
      <div className="sm:col-span-2">
        <label htmlFor="lot-title" className="label">
          Título del lote
        </label>
        <input id="lot-title" className="field" {...register('title')} />
        {errors.title && <p className="error">{errors.title.message}</p>}
      </div>
      <div>
        <label htmlFor="lot-start" className="label">
          Precio de salida
        </label>
        <input
          id="lot-start"
          inputMode="decimal"
          className="field"
          {...register('startingPrice')}
        />
        {errors.startingPrice && <p className="error">{errors.startingPrice.message}</p>}
      </div>
      <div>
        <label htmlFor="lot-inc" className="label">
          Incremento mínimo
        </label>
        <input id="lot-inc" inputMode="decimal" className="field" {...register('minIncrement')} />
        {errors.minIncrement && <p className="error">{errors.minIncrement.message}</p>}
      </div>
      <div>
        <label htmlFor="lot-cur" className="label">
          Moneda
        </label>
        <input id="lot-cur" maxLength={3} className="field uppercase" {...register('currency')} />
        {errors.currency && <p className="error">{errors.currency.message}</p>}
      </div>
      <div>
        <label htmlFor="lot-closes" className="label">
          Cierra
        </label>
        <input id="lot-closes" type="datetime-local" className="field" {...register('closesAt')} />
        {errors.closesAt && <p className="error">{errors.closesAt.message}</p>}
      </div>
      <div className="sm:col-span-2">
        <ErrorNote error={create.error} />
        <button type="submit" className="btn" disabled={create.isPending}>
          {create.isPending ? 'Publicando…' : 'Publicar lote'}
        </button>
      </div>
    </form>
  );
}
