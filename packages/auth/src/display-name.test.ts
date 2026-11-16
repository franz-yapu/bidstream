import { describe, expect, it } from 'vitest';
import { defaultDisplayName, displayNameProblems, normalizeDisplayName } from './display-name.js';

describe('nombre público', () => {
  it("normaliza espacios y acepta letras con acentos, números y . _ - '", () => {
    expect(normalizeDisplayName('  Ana   María  ')).toBe('Ana María');
    for (const ok of ['Ana', 'José Núñez', "o'Brien", 'user_01', 'Ana-Lu.7', '李雷']) {
      expect(displayNameProblems(ok), ok).toEqual([]);
    }
  });

  it('rechaza longitud fuera de rango, HTML, símbolos y el inicio con signo', () => {
    for (const bad of [
      '',
      'a',
      'x'.repeat(31),
      '<b>x</b>',
      'a@b.com',
      '-guion',
      'dos\nlíneas',
      '😀😀',
    ]) {
      expect(displayNameProblems(bad), bad).not.toEqual([]);
    }
  });

  it('el alias por defecto es válido y distingue administrador de postor', () => {
    const id = '0a1b2c3d-0000-4000-8000-000000000000';
    expect(defaultDisplayName('BIDDER', id)).toBe('Postor 0a1b');
    expect(defaultDisplayName('ADMIN', id)).toBe('Administrador 0a1b');
    expect(displayNameProblems(defaultDisplayName('ADMIN', id))).toEqual([]);
  });
});
