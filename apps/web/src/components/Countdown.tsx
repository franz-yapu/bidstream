import { useApi } from '../auth/context';
import { formatCountdown, useCountdown } from '../lib/time';

/** Tiempo que falta, corregido con el reloj del servidor. «Cerrando…» cuando llega a cero. */
export function Countdown({ closesAt, className = '' }: { closesAt: string; className?: string }) {
  const api = useApi();
  const remaining = useCountdown(closesAt, api.clock.offsetMs);
  return (
    <span className={`num ${className}`}>
      {remaining === 0 ? 'Cerrando…' : formatCountdown(remaining)}
    </span>
  );
}
