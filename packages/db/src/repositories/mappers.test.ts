import { describe, expect, it } from 'vitest';
import { decimalToMoney } from './mappers.js';

const decimal = (text: string): { toFixed(decimals: number): string } => ({
  toFixed: (decimals) => Number(text).toFixed(decimals),
});

describe('decimalToMoney', () => {
  it.each([
    ['10.50', 1050n],
    ['0.05', 5n],
    ['100', 10000n],
    ['0', 0n],
    ['9999999999.99', 999999999999n],
  ])('%s → %s centavos', (text, cents) => {
    expect(decimalToMoney(decimal(text))).toBe(cents);
  });

  it('devuelve siempre bigint, nunca number', () => {
    expect(typeof decimalToMoney(decimal('1.10'))).toBe('bigint');
  });

  it('usa toFixed(2) del Decimal (no convierte a number)', () => {
    let received: number | undefined;
    decimalToMoney({
      toFixed: (decimals) => {
        received = decimals;
        return '3.30';
      },
    });
    expect(received).toBe(2);
  });
});
