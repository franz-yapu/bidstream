import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor.js';

const cursor = {
  amount: '105.50',
  placedAt: new Date('2026-11-12T19:00:00.123Z'),
  id: '0190a5c0-0000-7000-8000-000000000001',
};
const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('cursor', () => {
  it('hace ida y vuelta sin perder precisión (milisegundos incluidos)', () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });
  it('es opaco: no es JSON legible ni contiene el importe en claro', () => {
    const text = encodeCursor(cursor);
    expect(text).not.toContain('105.50');
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it.each([
    ['basura', '!!!no es base64!!!'],
    ['JSON roto', Buffer.from('{no').toString('base64url')],
    ['faltan campos', b64({ a: '1.00' })],
    ['campo extra', b64({ a: '1.00', t: 1, i: cursor.id, x: 1 })],
    ['importe inválido', b64({ a: '1.005', t: 1, i: cursor.id })],
    ['importe numérico', b64({ a: 1.5, t: 1, i: cursor.id })],
    ['id que no es UUID', b64({ a: '1.00', t: 1, i: 'abc' })],
    ['fecha negativa', b64({ a: '1.00', t: -1, i: cursor.id })],
  ])('rechaza un cursor inválido: %s', (_name, value) => {
    expect(() => decodeCursor(value)).toThrow(/cursor inválido/);
  });
});
