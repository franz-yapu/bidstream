import { describe, expect, it } from 'vitest';
import { buildCommand, commandPartitionKey, parseCommand } from './index.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const LOT = '22222222-2222-4222-8222-222222222222';
const BIDDER = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-14T12:00:00.000Z');
const deps = { newId: () => '0190a5c0-0000-7000-8000-000000000001', now: () => NOW };

describe('PlaceBid', () => {
  const valid = () =>
    buildCommand('PlaceBid', TENANT, { lotId: LOT, bidderId: BIDDER, amount: '105.50' }, { deps });

  it('se fabrica con el sobre completo y se vuelve a parsear', () => {
    const command = valid();
    expect(command).toMatchObject({ type: 'PlaceBid', version: 1, receivedAt: NOW.toISOString() });
    const parsed = parseCommand(JSON.parse(JSON.stringify(command)));
    expect(parsed.success && parsed.command).toEqual(command);
  });

  it('usa lotId como clave de partición', () => {
    expect(commandPartitionKey(valid())).toBe(LOT);
  });

  it('acepta un commandId fijo (para claves de idempotencia) y meta.correlationId', () => {
    const id = '0190a5c0-0000-7000-8000-0000000000aa';
    const command = buildCommand(
      'PlaceBid',
      TENANT,
      { lotId: LOT, bidderId: BIDDER, amount: '1.00' },
      {
        deps,
        commandId: id,
        meta: { correlationId: 'req-1' },
      },
    );
    expect(command.commandId).toBe(id);
    expect(command.meta).toEqual({ correlationId: 'req-1' });
  });

  it.each([
    ['monto con más de 2 decimales', { amount: '1.005' }],
    ['monto negativo', { amount: '-1.00' }],
    ['monto numérico', { amount: 10 }],
    ['lotId que no es UUID', { lotId: 'x' }],
    ['bidderId ausente', { bidderId: undefined }],
    ['campo extra', { extra: true }],
  ])('rechaza %s', (_name, patch) => {
    const candidate = JSON.parse(JSON.stringify(valid())) as { payload: Record<string, unknown> };
    Object.assign(candidate.payload, patch);
    expect(parseCommand(candidate).success).toBe(false);
  });

  it('rechaza un tipo desconocido, otra versión y campos extra en el sobre', () => {
    const base = JSON.parse(JSON.stringify(valid())) as Record<string, unknown>;
    expect(parseCommand({ ...base, type: 'Otro' }).success).toBe(false);
    expect(parseCommand({ ...base, version: 2 }).success).toBe(false);
    expect(parseCommand({ ...base, extra: 1 }).success).toBe(false);
  });

  it('un evento de dominio no es un comando', () => {
    expect(parseCommand({ eventId: 'x', type: 'BidPlaced' }).success).toBe(false);
  });
});
