import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney } from './money.js';

describe('Money', () => {
  it('suma exacta: 0.1 + 0.2 = 0.30', () => {
    expect(formatMoney(parseMoney('0.1') + parseMoney('0.2'))).toBe('0.30');
  });
  it.each(['0', '10', '10.5', '105.50', '9999999999.99'])('hace ida y vuelta con %s', (v) => {
    expect(parseMoney(formatMoney(parseMoney(v)))).toBe(parseMoney(v));
  });
  it('normaliza a dos decimales', () => {
    expect(formatMoney(parseMoney('10.5'))).toBe('10.50');
    expect(formatMoney(parseMoney('7'))).toBe('7.00');
    expect(formatMoney(5n)).toBe('0.05');
  });
  it.each(['', '-1', '1.505', '1e3', '.5', '1.', 'abc', '12345678901'])('rechaza %s', (v) => {
    expect(() => parseMoney(v)).toThrow(RangeError);
  });
  it('no formatea montos negativos', () => {
    expect(() => formatMoney(-1n)).toThrow(RangeError);
  });
});
