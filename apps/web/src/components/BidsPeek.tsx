import { useQuery } from '@tanstack/react-query';
import { useApi } from '../auth/context';
import { formatMoney } from '../lib/money';
import { Avatar } from './Avatar';

/** Las pujas de un lote (las 5 mejores) sin salir de la lista; se piden solo al abrirlas. */
export function BidsPeek({
  lotId,
  currency,
  live,
}: {
  lotId: string;
  currency: string;
  live: boolean;
}) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['bids-peek', lotId],
    queryFn: () => api.getBids(lotId),
    refetchInterval: live ? 6000 : false,
  });
  if (query.isPending) {
    return (
      <p role="status" className="px-6 pb-5 text-[15px] text-ink-soft">
        Cargando pujas…
      </p>
    );
  }
  if (query.isError) return <p className="error px-6 pb-5">No se pudieron cargar las pujas.</p>;
  const bids = query.data.items.slice(0, 5);
  if (bids.length === 0) {
    return <p className="px-6 pb-5 text-[15px] text-ink-soft">Todavía no hay pujas.</p>;
  }
  return (
    <ol aria-label="Pujas del lote" className="space-y-2 px-6 pb-5">
      {bids.map((bid, i) => (
        <li key={bid.id} className="flex items-center gap-3 text-[15px]">
          <Avatar name={bid.bidder?.displayName ?? '?'} size={28} />
          <span className="min-w-0 flex-1 truncate">
            {bid.bidder?.displayName ?? 'Anónimo'}
            {i === 0 && (
              <span className="ml-2 text-[13px] text-forest">{live ? 'Va ganando' : 'Ganó'}</span>
            )}
          </span>
          <span className="num font-medium">{formatMoney(bid.amount, currency)}</span>
        </li>
      ))}
    </ol>
  );
}
