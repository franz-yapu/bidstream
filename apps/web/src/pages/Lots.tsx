import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../auth/context';
import { BidsSwitch } from '../components/BidsSwitch';
import { EmptyState } from '../components/EmptyState';
import { ErrorNote } from '../components/ErrorNote';
import { LotSections } from '../components/LotSections';
import { LotSort } from '../components/LotSort';
import { TicketSkeletons } from '../components/Skeleton';
import type { Lot } from '../api/types';
import { type LotOrder } from '../lib/lots';
import { usePageTitle } from '../lib/page-title';
import { useServerNow } from '../lib/time';

const SIZE = { auctions: 12, lots: 12 };

export function LotsPage() {
  usePageTitle('Todos los lotes');
  const api = useApi();
  const [order, setOrder] = useState<LotOrder>('closing');
  const [showBids, setShowBids] = useState(false);
  const open = useQuery({
    queryKey: ['lots-board', 'OPEN'],
    queryFn: () => api.board('OPEN', SIZE),
    refetchInterval: 8000,
  });
  const closed = useQuery({
    queryKey: ['lots-board', 'CLOSED'],
    queryFn: () => api.board('CLOSED', SIZE),
    refetchInterval: 20_000,
  });
  const now = useServerNow(api.clock.offsetMs);

  const lots: Lot[] = [];
  const titles = new Map<string, string>();
  // una subasta que aún no abre no admite pujas: sus lotes no están «en proceso» todavía
  for (const a of (open.data ?? []).filter((x) => Date.parse(x.opensAt) <= now)) {
    for (const lot of a.lots.filter((l) => l.status === 'OPEN')) {
      lots.push(lot);
      titles.set(lot.id, a.title);
    }
  }
  for (const a of closed.data ?? []) {
    for (const lot of a.lots.filter((l) => l.status === 'CLOSED')) {
      lots.push(lot);
      titles.set(lot.id, a.title);
    }
  }
  const pending = open.isPending || closed.isPending;

  return (
    <section className="pt-6">
      <h1 className="rise text-5xl sm:text-6xl">Todos los lotes</h1>
      <p
        className="rise mt-3 max-w-xl text-lg text-ink-soft"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        Primero lo que está en proceso, debajo lo que ya terminó. Abre las pujas sin entrar en cada
        lote.
      </p>

      <div className="mt-8 mb-10 flex flex-wrap items-center justify-between gap-4">
        <BidsSwitch checked={showBids} onChange={setShowBids} />
        <LotSort value={order} onChange={setOrder} />
      </div>

      {pending && <TicketSkeletons />}
      <ErrorNote error={open.error ?? closed.error} />
      {!pending && lots.length === 0 && (
        <EmptyState title="Todavía no hay lotes">
          Vuelve en un rato: la lista se actualiza sola.
        </EmptyState>
      )}
      <LotSections lots={lots} order={order} showBids={showBids} titles={titles} />
    </section>
  );
}
