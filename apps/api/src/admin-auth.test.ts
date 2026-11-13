import { describe, expect, it } from 'vitest';
import { adminKeyMatches } from './admin-auth.js';

const KEY = 'una-clave-de-servicio-de-al-menos-32-caracteres';

describe('adminKeyMatches', () => {
  it('acepta solo la clave exacta', () => {
    expect(adminKeyMatches(KEY, KEY)).toBe(true);
    expect(adminKeyMatches(`${KEY}x`, KEY)).toBe(false);
    expect(adminKeyMatches(KEY.slice(0, -1), KEY)).toBe(false);
    expect(adminKeyMatches(KEY.toUpperCase(), KEY)).toBe(false);
  });
  it('una clave ausente o vacía se rechaza', () => {
    expect(adminKeyMatches(undefined, KEY)).toBe(false);
    expect(adminKeyMatches('', KEY)).toBe(false);
  });
  it('claves de cualquier longitud no revientan la comparación (se comparan hashes)', () => {
    for (const length of [1, 31, 32, 33, 1_000, 100_000]) {
      expect(() => adminKeyMatches('x'.repeat(length), KEY)).not.toThrow();
      expect(adminKeyMatches('x'.repeat(length), KEY)).toBe(false);
    }
  });
});
