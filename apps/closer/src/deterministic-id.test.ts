import { buildCommand } from '@bidstream/domain';
import { describe, expect, it } from 'vitest';
import { deterministicUuidV7 } from './deterministic-id.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const LOT = '22222222-2222-4222-8222-222222222222';

describe('deterministicUuidV7', () => {
  it('es estable, distinto para distintas semillas y válido como commandId', () => {
    const a = deterministicUuidV7(`${LOT}:2026-11-14T12:00:00.000Z`);
    expect(deterministicUuidV7(`${LOT}:2026-11-14T12:00:00.000Z`)).toBe(a);
    expect(deterministicUuidV7(`${LOT}:2026-11-14T12:01:00.000Z`)).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(buildCommand('CloseLot', TENANT, { lotId: LOT }, { commandId: a }).commandId).toBe(a);
  });
});
