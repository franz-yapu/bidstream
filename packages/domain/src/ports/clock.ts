/** Fuente de la hora actual; el dominio nunca lee el reloj del sistema directamente. */
export interface Clock {
  now(): Date;
}
