import { describe, expect, it } from 'vitest';
import { compareMoney, formatMoney, fromCents, parseMoneyInput, toCents } from './money';

describe('Money (céntimos con BigInt, sin number)', () => {
  it('convierte de ida y vuelta sin pérdida, también con importes enormes', () => {
    expect(toCents('105.50')).toBe(10550n);
    expect(fromCents(10550n)).toBe('105.50');
    expect(fromCents(5n)).toBe('0.05');
    expect(fromCents(toCents('9999999999.99'))).toBe('9999999999.99');
    expect(() => toCents('105.5')).toThrow(TypeError);
  });

  it('compara con exactitud (donde un float fallaría)', () => {
    expect(compareMoney('0.10', '0.20')).toBe(-1);
    expect(compareMoney('100.00', '100.00')).toBe(0);
    expect(compareMoney('100.01', '100.00')).toBe(1);
  });

  it('interpreta lo que escribe el usuario', () => {
    expect(parseMoneyInput('105')).toBe('105.00');
    expect(parseMoneyInput('105,5')).toBe('105.50');
    expect(parseMoneyInput(' 105.50 ')).toBe('105.50');
    for (const bad of ['', '0', '0.00', '-5', '1.234', 'abc', '1e5', '12345678901']) {
      expect(parseMoneyInput(bad), bad).toBeNull();
    }
  });

  it('da formato con separador de miles', () => {
    expect(formatMoney('1234567.50', 'USD')).toBe('1,234,567.50 USD');
    expect(formatMoney('5.00', 'EUR')).toBe('5.00 EUR');
  });
});
