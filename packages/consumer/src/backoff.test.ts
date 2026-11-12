import { describe, expect, it } from 'vitest';
import { backoffDelay, DEFAULT_RETRY_POLICY } from './backoff.js';

describe('backoffDelay', () => {
  const max = (retry: number): number => backoffDelay(retry, DEFAULT_RETRY_POLICY, () => 1);

  it('el techo crece por potencias de 2: 200, 400, 800 ms', () => {
    expect([max(1), max(2), max(3)]).toEqual([200, 400, 800]);
  });
  it('respeta el tope', () => {
    expect(max(10)).toBe(DEFAULT_RETRY_POLICY.capMs);
  });
  it('con jitter queda entre 0 y el techo', () => {
    expect(backoffDelay(3, DEFAULT_RETRY_POLICY, () => 0)).toBe(0);
    expect(backoffDelay(3, DEFAULT_RETRY_POLICY, () => 0.5)).toBe(400);
    for (let i = 0; i < 200; i++) {
      const d = backoffDelay(2, DEFAULT_RETRY_POLICY);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(400);
    }
  });
  it('acepta una política propia', () => {
    const policy = { maxRetries: 1, baseDelayMs: 10, factor: 3, capMs: 1000 };
    expect(backoffDelay(2, policy, () => 1)).toBe(30);
  });
  it('por defecto son 3 reintentos (4 intentos en total)', () => {
    expect(DEFAULT_RETRY_POLICY.maxRetries).toBe(3);
  });
});
