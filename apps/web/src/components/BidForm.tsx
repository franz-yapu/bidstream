import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { LotWithAuction } from '../api/types';
import { useApi } from '../auth/context';
import { compareMoney, formatMoney, fromCents, parseMoneyInput, toCents } from '../lib/money';
import { Check } from './icons';
import { ErrorNote } from './ErrorNote';

/** Tiempo que se espera la confirmación de una puja aceptada antes de avisar de que no es la vigente. */
export const CONFIRMATION_WAIT_MS = 10_000;

interface Pending {
  readonly amount: string;
  readonly sentAt: number;
  /** Pasó el tiempo de espera sin que la puja figure como precio vigente. */
  readonly expired: boolean;
}

/**
 * Formulario de puja. El `202` solo significa «aceptada»: el decisor la resuelve después y el
 * resultado llega por el canal en vivo (precio vigente). La `Idempotency-Key` es estable mientras el
 * importe no cambie —un reintento tras un fallo de red repite la misma— y se renueva tras cada puja.
 */
export function BidForm({ lot, closed }: { lot: LotWithAuction; closed: boolean }) {
  const api = useApi();
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const key = useRef<{ amount: string; value: string } | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  const bid = useMutation({
    mutationFn: ({ amount, idempotencyKey }: { amount: string; idempotencyKey: string }) =>
      api.placeBid(lot.id, amount, idempotencyKey),
    onSuccess: (_result, { amount }) => {
      key.current = null; // la siguiente puja usa una clave nueva
      setPending({ amount, sentAt: Date.now(), expired: false });
    },
  });

  // ¿quedó como precio vigente? Se deduce del precio que llega por el canal en vivo; sin confirmación
  // tras un tiempo se avisa, sin inventar el motivo (el rechazo no se publica por GraphQL).
  const reached =
    pending !== null &&
    lot.currentPrice !== null &&
    compareMoney(lot.currentPrice, pending.amount) >= 0;
  const outcome: 'waiting' | 'won' | 'lost' | null =
    pending === null
      ? null
      : reached
        ? lot.currentPrice === pending.amount
          ? 'won'
          : 'lost'
        : pending.expired
          ? 'lost'
          : 'waiting';
  const waitingSince = pending !== null && outcome === 'waiting' ? pending.sentAt : null;
  useEffect(() => {
    if (waitingSince === null) return;
    const timer = setTimeout(
      () => {
        setPending((current) =>
          current?.sentAt === waitingSince ? { ...current, expired: true } : current,
        );
      },
      Math.max(0, waitingSince + CONFIRMATION_WAIT_MS - Date.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [waitingSince]);

  const minimum = lot.nextMinimumBid;
  // atajos: el mínimo y unos saltos de incremento (en céntimos, sin coma flotante)
  const quick = [0n, 1n, 3n, 10n].map((steps) => ({
    amount: fromCents(toCents(minimum) + steps * toCents(lot.minIncrement)),
    label: fromCents(toCents(minimum) + steps * toCents(lot.minIncrement)),
  }));

  function submit(event: React.SyntheticEvent): void {
    event.preventDefault();
    const amount = parseMoneyInput(text);
    if (amount === null) {
      setInvalid('Escribe un importe válido (hasta 2 decimales).');
      return;
    }
    if (compareMoney(amount, minimum) < 0) {
      setInvalid(`La puja mínima es ${formatMoney(minimum, lot.currency)}.`);
      return;
    }
    setInvalid(null);
    if (key.current?.amount !== amount) key.current = { amount, value: crypto.randomUUID() };
    bid.mutate({ amount, idempotencyKey: key.current.value });
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-3" aria-label="Pujar">
      <div>
        <label htmlFor="bid-amount" className="label">
          Tu puja ({lot.currency})
        </label>
        <input
          id="bid-amount"
          ref={input}
          inputMode="decimal"
          autoComplete="off"
          className="field"
          placeholder={minimum}
          value={text}
          disabled={closed}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
        <p className="mt-1.5 text-[14px] text-ink-soft">
          Mínimo: {formatMoney(minimum, lot.currency)}
        </p>
        {!closed && (
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Importes rápidos">
            {quick.map(({ amount, label }) => (
              <button
                key={amount}
                type="button"
                aria-label={`Usar ${formatMoney(amount, lot.currency)}`}
                aria-pressed={text === amount}
                onClick={() => {
                  setText(amount);
                  setInvalid(null);
                  input.current?.focus();
                }}
                className={`num rounded-full px-3.5 py-1.5 text-[15px] font-medium transition-[background-color,transform] duration-150 ease-out active:scale-[0.96] ${text === amount ? 'bg-ink text-paper' : 'bg-sand text-ink [@media(hover:hover)]:hover:bg-sand-deep'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {invalid !== null && (
        <p role="alert" className="error">
          {invalid}
        </p>
      )}
      <ErrorNote error={bid.error} />
      <button type="submit" className="btn w-full" disabled={closed || bid.isPending}>
        {bid.isPending ? 'Enviando…' : closed ? 'Lote cerrado' : 'Pujar'}
      </button>
      {outcome === 'waiting' && pending !== null && (
        <p role="status" className="text-[15px]">
          Puja de {formatMoney(pending.amount, lot.currency)} enviada. Esperando confirmación…
        </p>
      )}
      {outcome === 'won' && (
        <p role="status" className="flex items-center gap-1.5 text-[15px] font-medium text-forest">
          <Check /> Tu puja es la vigente
        </p>
      )}
      {outcome === 'lost' && (
        <p role="status" className="text-[15px] font-medium text-crimson">
          Tu puja no quedó como vigente: otra fue mayor o no cumplió las reglas del lote.
        </p>
      )}
    </form>
  );
}
