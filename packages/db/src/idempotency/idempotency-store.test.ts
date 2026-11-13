import { describe, expect, it } from 'vitest';
import { requestHash } from './idempotency-store.js';

describe('requestHash', () => {
  it('es estable ante el orden de las claves', () => {
    expect(requestHash({ lotId: 'a', amount: '1.00' })).toBe(
      requestHash({ amount: '1.00', lotId: 'a' }),
    );
  });
  it('cambia con cualquier valor o clave distintos', () => {
    const base = requestHash({ lotId: 'a', amount: '1.00' });
    expect(requestHash({ lotId: 'a', amount: '1.01' })).not.toBe(base);
    expect(requestHash({ lotId: 'b', amount: '1.00' })).not.toBe(base);
    expect(requestHash({ lotId: 'a', amount: '1.00', extra: 'x' })).not.toBe(base);
  });
  it('no confunde valores que concatenados serían iguales', () => {
    expect(requestHash({ a: 'bc', d: 'e' })).not.toBe(requestHash({ a: 'b', cd: 'e' }));
  });
  it('es un SHA-256 en hexadecimal', () => {
    expect(requestHash({ a: 'b' })).toMatch(/^[0-9a-f]{64}$/);
  });
});
