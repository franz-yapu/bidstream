import { useState } from 'react';
import { Link } from 'react-router';
import type { Lot } from '../api/types';
import { formatMoney } from '../lib/money';
import { BidsPeek } from './BidsPeek';
import { Countdown } from './Countdown';
import { FlashText } from './FlashText';
import { LotCover } from './LotCover';
import { StatusBadge } from './StatusBadge';

/** Línea de la parte inferior del billete: quién va ganando o ganó, o que aún no hay pujas. */
function stubText(lot: Lot): string {
  if (lot.status === 'CLOSED') {
    if (lot.winner) return `Ganó ${lot.winner.displayName}`;
    return lot.finalAmount === null ? 'Terminó sin pujas' : 'Adjudicado';
  }
  if (lot.leader) return `Va ganando ${lot.leader.displayName}`;
  return lot.currentPrice === null ? 'Sin pujas todavía' : 'Con pujas';
}

/**
 * El lote como entrada de catálogo: título grande, precio vigente y tiempo que falta; debajo de la
 * perforación, quién va ganando. Todo el billete es un enlace al lote.
 */
export function LotTicket({
  lot,
  auctionTitle,
  featured = false,
  showBids = false,
}: {
  lot: Lot;
  auctionTitle?: string | undefined;
  featured?: boolean;
  /** Abre las pujas de todos los billetes de la lista (interruptor de la página). */
  showBids?: boolean;
}) {
  const [own, setOwn] = useState<boolean | null>(null);
  const bidsOpen = own ?? showBids;
  const closed = lot.status === 'CLOSED';
  const price =
    closed && lot.finalAmount !== null ? lot.finalAmount : (lot.currentPrice ?? lot.startingPrice);
  return (
    <div
      className={`ticket group relative transition-transform duration-200 ease-out [@media(hover:hover)]:hover:-translate-y-0.5 ${closed ? 'bg-sand/70' : 'border-t-[5px] border-forest'}`}
    >
      <div className={featured ? 'h-44 sm:h-56' : 'h-32'}>
        <LotCover
          seed={lot.id}
          className={`transition-transform duration-500 ease-out [@media(hover:hover)]:group-hover:scale-[1.03] ${closed ? 'grayscale-[0.7]' : ''}`}
        />
      </div>
      <div className={`flex flex-1 flex-col gap-5 p-6 ${featured ? 'sm:p-8' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-[15px] text-ink-soft">{auctionTitle ?? ' '}</p>
          <StatusBadge status={lot.status} />
        </div>
        <h3
          className={`display ${featured ? 'text-4xl sm:text-5xl' : 'text-[1.65rem]'} leading-[1.08]`}
        >
          <Link to={`/lotes/${lot.id}`} className="after:absolute after:inset-0 after:content-['']">
            {lot.title}
          </Link>
        </h3>
        <div className="mt-auto flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <p className="text-[15px] text-ink-soft">
              {closed
                ? 'Precio final'
                : lot.currentPrice === null
                  ? 'Precio de salida'
                  : 'Precio vigente'}
            </p>
            <p className={`display num ${featured ? 'text-5xl' : 'text-3xl'}`}>
              <FlashText value={formatMoney(price, lot.currency)} />
            </p>
          </div>
          <p className="text-right text-[15px] text-ink-soft">
            {closed ? (
              'Terminó'
            ) : (
              <>
                Cierra en
                <br />
                <Countdown closesAt={lot.closesAt} className="text-lg font-medium text-ink" />
              </>
            )}
          </p>
        </div>
      </div>
      <div className="ticket-stub">
        <span className="font-medium">
          <FlashText value={stubText(lot)} />
        </span>
        <button
          type="button"
          aria-expanded={bidsOpen}
          onClick={() => {
            setOwn(!bidsOpen);
          }}
          className="relative z-10 shrink-0 rounded-full bg-sand px-3.5 py-1.5 text-[14px] font-medium transition-[transform,background-color] duration-150 ease-out active:scale-[0.97] [@media(hover:hover)]:hover:bg-sand-deep"
        >
          {bidsOpen ? 'Ocultar pujas' : 'Ver pujas'}
        </button>
      </div>
      {bidsOpen && (
        <div className="pt-4">
          <BidsPeek lotId={lot.id} currency={lot.currency} live={!closed} />
        </div>
      )}
    </div>
  );
}
