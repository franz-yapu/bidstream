import { describe, expect, it } from 'vitest';
import { InMemoryNotificationBus } from './bus.js';
import type { LotNotification } from './notification.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '99999999-9999-4999-8999-999999999999';
const LOT1 = '33333333-3333-4333-8333-333333333333';
const LOT2 = '44444444-4444-4444-8444-444444444444';

const note = (tenantId: string, lotId: string): LotNotification => ({
  type: 'LotExtended',
  eventId: '0190a5c0-0000-7000-8000-000000000001',
  occurredAt: '2026-11-13T20:00:00.000Z',
  tenantId,
  lotId,
  newClosesAt: '2026-11-13T20:05:00.000Z',
});

describe('InMemoryNotificationBus', () => {
  it('reparte solo a los suscriptores de ese tenant y ese lote', () => {
    const bus = new InMemoryNotificationBus();
    const got: string[] = [];
    bus.subscribe(A, LOT1, () => got.push('A/LOT1'));
    bus.subscribe(A, LOT2, () => got.push('A/LOT2'));
    bus.subscribe(B, LOT1, () => got.push('B/LOT1'));
    bus.publish(note(A, LOT1));
    expect(got).toEqual(['A/LOT1']);
  });

  it('varios suscriptores del mismo lote reciben todos la notificación', () => {
    const bus = new InMemoryNotificationBus();
    let n = 0;
    bus.subscribe(A, LOT1, () => (n += 1));
    bus.subscribe(A, LOT1, () => (n += 10));
    bus.publish(note(A, LOT1));
    expect(n).toBe(11);
  });

  it('quien se da de baja deja de recibir', () => {
    const bus = new InMemoryNotificationBus();
    let n = 0;
    const unsubscribe = bus.subscribe(A, LOT1, () => (n += 1));
    bus.publish(note(A, LOT1));
    unsubscribe();
    bus.publish(note(A, LOT1));
    expect(n).toBe(1);
  });

  it('un suscriptor que lanza no impide el reparto a los demás y el error se informa', () => {
    const errors: unknown[] = [];
    const bus = new InMemoryNotificationBus((e) => errors.push(e));
    let delivered = 0;
    bus.subscribe(A, LOT1, () => {
      throw new Error('suscriptor roto');
    });
    bus.subscribe(A, LOT1, () => (delivered += 1));
    bus.publish(note(A, LOT1));
    expect(delivered).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it('publicar sin suscriptores no hace nada', () => {
    expect(() => {
      new InMemoryNotificationBus().publish(note(A, LOT1));
    }).not.toThrow();
  });

  it('el aviso de resincronización llega a quien lo escucha y se puede cancelar', () => {
    const bus = new InMemoryNotificationBus();
    let n = 0;
    const off = bus.onResync(() => (n += 1));
    bus.publishResync();
    off();
    bus.publishResync();
    expect(n).toBe(1);
  });

  it('subscriptionCount cuenta las suscripciones activas y baja al cancelarlas', () => {
    const bus = new InMemoryNotificationBus();
    expect(bus.subscriptionCount()).toBe(0);
    const off1 = bus.subscribe(A, LOT1, () => undefined);
    const off2 = bus.subscribe(A, LOT1, () => undefined);
    bus.subscribe(B, LOT2, () => undefined);
    expect(bus.subscriptionCount()).toBe(3);
    off1();
    off2();
    expect(bus.subscriptionCount()).toBe(1);
  });
});
