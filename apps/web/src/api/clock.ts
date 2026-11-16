/**
 * Desfase entre el reloj del servidor y el del cliente (ms), a partir de la cabecera `Date` de las
 * respuestas (precisión de un segundo). La cuenta atrás lo usa para no adelantarse ni retrasarse; el
 * cierre real lo decide siempre el backend.
 */
export class ServerClock {
  private offset = 0;

  get offsetMs(): number {
    return this.offset;
  }

  observe(res: Response, nowMs: number = Date.now()): void {
    const header = res.headers.get('date');
    if (header === null) return;
    const server = Date.parse(header);
    if (Number.isFinite(server)) this.offset = server - nowMs;
  }
}
