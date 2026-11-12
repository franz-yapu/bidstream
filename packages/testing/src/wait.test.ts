import { describe, expect, it } from 'vitest';
import { waitFor } from './wait.js';

describe('waitFor', () => {
  it('resuelve en cuanto la condición se cumple', async () => {
    let calls = 0;
    await waitFor(() => ++calls >= 3, { intervalMs: 5 });
    expect(calls).toBe(3);
  });
  it('admite condiciones asíncronas', async () => {
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 20);
    await waitFor(() => Promise.resolve(ready), { intervalMs: 5 });
    expect(ready).toBe(true);
  });
  it('falla con un mensaje claro al agotar el tiempo', async () => {
    await expect(
      waitFor(() => false, { timeoutMs: 40, intervalMs: 5, description: 'la subasta' }),
    ).rejects.toThrow(/timeout de 40 ms esperando la subasta/);
  });
});
