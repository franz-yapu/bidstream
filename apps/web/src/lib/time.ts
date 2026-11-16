import { useEffect, useState } from 'react';

/** Milisegundos que faltan para `closesAt`; nunca negativo. `offsetMs` corrige el reloj del cliente. */
export function remainingMs(closesAt: string, nowMs: number, offsetMs = 0): number {
  return Math.max(0, Date.parse(closesAt) - (nowMs + offsetMs));
}

/** «1 d 02:03:04», «02:03:04» o «03:04». */
export function formatCountdown(ms: number): string {
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (n: number): string => String(n).padStart(2, '0');
  if (days > 0) return `${String(days)} d ${two(hours)}:${two(minutes)}:${two(seconds)}`;
  if (hours > 0) return `${two(hours)}:${two(minutes)}:${two(seconds)}`;
  return `${two(minutes)}:${two(seconds)}`;
}

/** Fecha y hora local legibles a partir de un instante ISO. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Cuenta atrás que se refresca cada segundo; `offsetMs` = hora del servidor − hora del cliente. */
export function useCountdown(closesAt: string, offsetMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return remainingMs(closesAt, now, offsetMs);
}
