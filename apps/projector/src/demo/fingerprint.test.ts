import { describe, expect, it } from 'vitest';
import { canonicalJson, fingerprintRows } from './fingerprint.js';

describe('huella de la proyección', () => {
  const rows = {
    bids: [
      { id: 'b2', amount: '110.00', awarded: true },
      { id: 'b1', amount: '100.00', awarded: false },
    ],
    lots: [{ id: 'l1', status: 'closed' }],
  };

  it('es la misma para el mismo estado, venga en el orden que venga', () => {
    const shuffled = { lots: rows.lots, bids: [...rows.bids].reverse() };
    expect(fingerprintRows(shuffled)).toBe(fingerprintRows(rows));
  });

  it('no depende del orden de las claves de cada fila', () => {
    const reordered = {
      bids: [
        { awarded: true, amount: '110.00', id: 'b2' },
        { awarded: false, id: 'b1', amount: '100.00' },
      ],
      lots: rows.lots,
    };
    expect(fingerprintRows(reordered)).toBe(fingerprintRows(rows));
  });

  it('cambia si se altera una puja, se añade o se quita una fila', () => {
    const base = fingerprintRows(rows);
    const altered = {
      ...rows,
      bids: [{ id: 'b2', amount: '110.01', awarded: true }, rows.bids[1]],
    };
    expect(fingerprintRows(altered)).not.toBe(base);
    expect(fingerprintRows({ ...rows, bids: [rows.bids[0]] })).not.toBe(base);
    expect(fingerprintRows({ ...rows, lots: [] })).not.toBe(base);
  });

  it('una tabla vacía no equivale a una tabla ausente con otro nombre', () => {
    expect(fingerprintRows({ a: [] })).not.toBe(fingerprintRows({ b: [] }));
  });

  it('serializa fechas, bigint y decimales como texto estable', () => {
    const decimalLike = { toFixed: () => '12.50' };
    expect(canonicalJson({ d: new Date('2026-11-13T10:00:00.000Z'), n: 5n, m: decimalLike })).toBe(
      '{"d":"2026-11-13T10:00:00.000Z","m":"12.50","n":"5"}',
    );
  });
});
