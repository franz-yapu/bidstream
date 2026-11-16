import { describe, expect, it } from 'vitest';
import { formatCountdown, remainingMs } from './time';

describe('tiempo', () => {
  it('remainingMs no baja de cero y aplica el desfase del servidor', () => {
    const closes = '2030-01-01T10:00:00.000Z';
    const at = Date.parse('2030-01-01T09:59:00.000Z');
    expect(remainingMs(closes, at)).toBe(60_000);
    expect(remainingMs(closes, at, 30_000)).toBe(30_000); // el servidor va 30 s por delante
    expect(remainingMs(closes, Date.parse('2030-01-01T10:00:01.000Z'))).toBe(0);
  });

  it('formatCountdown muestra días, horas y minutos solo cuando hacen falta', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(65_000)).toBe('01:05');
    expect(formatCountdown(3_723_000)).toBe('01:02:03');
    expect(formatCountdown(93_784_000)).toBe('1 d 02:03:04');
  });
});
