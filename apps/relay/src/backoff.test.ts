import { describe, expect, it } from 'vitest';
import { backoffDelay, DEFAULT_BACKOFF } from './backoff.js';

describe('backoffDelay', () => {
  const max = (failures: number): number => backoffDelay(failures, DEFAULT_BACKOFF, () => 1);
  const min = (failures: number): number => backoffDelay(failures, DEFAULT_BACKOFF, () => 0);

  it('el techo crece por potencias de 2: 1, 2, 4 s', () => {
    expect([max(1), max(2), max(3)]).toEqual([1_000, 2_000, 4_000]);
  });
  it('respeta el tope de 30 s', () => {
    expect(max(20)).toBe(30_000);
  });
  it('mantiene la mitad fija: nunca espera menos de la mitad del techo', () => {
    expect([min(1), min(2), min(3)]).toEqual([500, 1_000, 2_000]);
    expect(min(20)).toBe(15_000);
  });
  it('con jitter queda entre la mitad y el techo', () => {
    for (let i = 0; i < 200; i++) {
      const d = backoffDelay(3, DEFAULT_BACKOFF);
      expect(d).toBeGreaterThanOrEqual(2_000);
      expect(d).toBeLessThanOrEqual(4_000);
    }
  });
});
