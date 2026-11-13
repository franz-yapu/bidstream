import { InMemoryNotificationBus, type LotNotification } from '@bidstream/notifier';
import { describe, expect, it } from 'vitest';
import { lotUpdates, type LotUpdatePayload } from './iterator.js';
import { SubscriptionRegistry } from './registry.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '99999999-9999-4999-8999-999999999999';
const LOT = '33333333-3333-4333-8333-333333333333';

let counter = 0;
const note = (tenantId = A, lotId = LOT): LotNotification => {
  counter += 1;
  return {
    type: 'BidPlaced',
    eventId: `0190a5c0-0000-7000-8000-${counter.toString(16).padStart(12, '0')}`,
    occurredAt: '2026-11-13T20:00:00.000Z',
    tenantId,
    lotId,
    amount: `${String(100 + counter)}.00`,
    placedAt: '2026-11-13T19:00:00.000Z',
  };
};

const take = async (
  it: AsyncIterableIterator<LotUpdatePayload>,
  n: number,
): Promise<LotUpdatePayload[]> => {
  const out: LotUpdatePayload[] = [];
  for (let i = 0; i < n; i++) {
    const r = await it.next();
    if (r.done === true) break;
    out.push(r.value);
  }
  return out;
};

describe('lotUpdates', () => {
  it('entrega las notificaciones del lote en orden, y solo las de su tenant y lote', async () => {
    const bus = new InMemoryNotificationBus();
    const it = lotUpdates({ bus, tenantId: A, lotId: LOT, maxQueue: 10 });
    const first = note();
    const second = note();
    bus.publish(note(B, LOT)); // otro tenant
    bus.publish(note(A, '44444444-4444-4444-8444-444444444444')); // otro lote
    bus.publish(first);
    bus.publish(second);
    expect(await take(it, 2)).toEqual([first, second]);
    await it.return?.();
  });

  it('un next() que espera se resuelve en cuanto llega una notificación', async () => {
    const bus = new InMemoryNotificationBus();
    const it = lotUpdates({ bus, tenantId: A, lotId: LOT, maxQueue: 10 });
    const pending = it.next();
    const n = note();
    bus.publish(n);
    expect(await pending).toEqual({ value: n, done: false });
    await it.return?.();
  });

  it('con la cola desbordada descarta lo pendiente y deja un único ResyncRequired', async () => {
    const bus = new InMemoryNotificationBus();
    const it = lotUpdates({ bus, tenantId: A, lotId: LOT, maxQueue: 3 });
    for (let i = 0; i < 10; i++) bus.publish(note());
    const items = await take(it, 1);
    expect(items[0]).toMatchObject({ type: 'ResyncRequired' });
    // tras recibir el aviso, las nuevas notificaciones vuelven a llegar con normalidad
    const fresh = note();
    bus.publish(fresh);
    expect(await take(it, 1)).toEqual([fresh]);
    await it.return?.();
  });

  it('la memoria no crece sin límite: la cola nunca supera su máximo', async () => {
    const bus = new InMemoryNotificationBus();
    const it = lotUpdates({ bus, tenantId: A, lotId: LOT, maxQueue: 5 });
    for (let i = 0; i < 10_000; i++) bus.publish(note());
    // lo que queda por leer es, como mucho, un aviso y una cola que no llegó a llenarse
    const drained: LotUpdatePayload[] = [];
    bus.publish(note());
    for (;;) {
      const r = await Promise.race([
        it.next(),
        new Promise<'vacío'>((resolve) => {
          setTimeout(() => {
            resolve('vacío');
          }, 20);
        }),
      ]);
      if (r === 'vacío' || r.done === true) break;
      drained.push(r.value);
    }
    expect(drained.length).toBeLessThanOrEqual(6);
    await it.return?.();
  });

  it('el aviso de resincronización del bus llega al suscriptor', async () => {
    const bus = new InMemoryNotificationBus();
    const it = lotUpdates({ bus, tenantId: A, lotId: LOT, maxQueue: 10 });
    bus.publishResync();
    expect(await take(it, 1)).toEqual([expect.objectContaining({ type: 'ResyncRequired' })]);
    await it.return?.();
  });

  it('un cliente lento no frena a los demás', async () => {
    const bus = new InMemoryNotificationBus();
    const slow = lotUpdates({ bus, tenantId: A, lotId: LOT, maxQueue: 2 });
    const fast = lotUpdates({ bus, tenantId: A, lotId: LOT, maxQueue: 2 });
    const received: LotUpdatePayload[] = [];
    const reader = (async () => {
      for (let i = 0; i < 6; i++) {
        const r = await fast.next();
        if (r.done === true) return;
        received.push(r.value);
      }
    })();
    for (let i = 0; i < 6; i++) {
      bus.publish(note());
      await new Promise((resolve) => setTimeout(resolve, 1)); // el rápido lee entre publicaciones
    }
    await reader;
    expect(received.filter((r) => r.type === 'BidPlaced')).toHaveLength(6);
    expect((await take(slow, 1))[0]).toMatchObject({ type: 'ResyncRequired' });
    await slow.return?.();
    await fast.return?.();
  });

  it('return() cancela las suscripciones, libera el cupo una sola vez y termina el flujo', async () => {
    const bus = new InMemoryNotificationBus();
    let released = 0;
    const it = lotUpdates({
      bus,
      tenantId: A,
      lotId: LOT,
      maxQueue: 10,
      onClose: () => (released += 1),
    });
    expect(bus.subscriptionCount()).toBe(1);
    const pending = it.next();
    await it.return?.();
    await it.return?.(); // idempotente
    expect(await pending).toEqual({ value: undefined, done: true });
    expect(bus.subscriptionCount()).toBe(0);
    expect(released).toBe(1);
    bus.publish(note()); // tras cerrar no se acumula nada
    expect(await it.next()).toEqual({ value: undefined, done: true });
  });

  it('throw() también limpia', async () => {
    const bus = new InMemoryNotificationBus();
    const it = lotUpdates({ bus, tenantId: A, lotId: LOT, maxQueue: 10 });
    await expect(it.throw?.(new Error('cliente caído'))).rejects.toThrow('cliente caído');
    expect(bus.subscriptionCount()).toBe(0);
  });
});

describe('SubscriptionRegistry', () => {
  it('limita las suscripciones por tenant y libera el cupo', () => {
    const registry = new SubscriptionRegistry();
    const releases = [registry.acquire(A, 2), registry.acquire(A, 2)];
    expect(() => registry.acquire(A, 2)).toThrow(/máximo de 2/);
    expect(registry.count(A)).toBe(2);
    releases[0]?.();
    expect(registry.count(A)).toBe(1);
    expect(() => registry.acquire(A, 2)).not.toThrow();
  });

  it('el cupo es por tenant', () => {
    const registry = new SubscriptionRegistry();
    registry.acquire(A, 1);
    expect(() => registry.acquire(B, 1)).not.toThrow();
    expect(registry.count()).toBe(2);
  });

  it('liberar dos veces no libera cupo de otro', () => {
    const registry = new SubscriptionRegistry();
    const release = registry.acquire(A, 5);
    registry.acquire(A, 5);
    release();
    release();
    expect(registry.count(A)).toBe(1);
  });

  it('el error al superar el cupo tiene código estable', () => {
    const registry = new SubscriptionRegistry();
    registry.acquire(A, 1);
    try {
      registry.acquire(A, 1);
      throw new Error('debía fallar');
    } catch (error) {
      expect((error as { extensions?: { code?: string } }).extensions?.code).toBe(
        'TOO_MANY_SUBSCRIPTIONS',
      );
    }
  });
});
