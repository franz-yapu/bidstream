import { randomUUID } from 'node:crypto';
import { buildEvent } from '@bidstream/domain';
import { createTestDatabase, waitFor, type TestDatabase } from '@bidstream/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryNotificationBus } from './bus.js';
import { startNotificationListener, type RunningNotificationListener } from './listener.js';
import { toLotNotification, type LotNotification } from './notification.js';
import { NOTIFICATION_CHANNEL, publishNotification } from './publisher.js';

// El canal LISTEN/NOTIFY contra PostgreSQL real (base desechable).
const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';

let db: TestDatabase;
const listeners: RunningNotificationListener[] = [];

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await Promise.all(listeners.map((l) => l.stop()));
  await db.drop();
});

async function listen(
  bus = new InMemoryNotificationBus(),
): Promise<{ bus: InMemoryNotificationBus; listener: RunningNotificationListener }> {
  const listener = startNotificationListener({
    connectionString: db.url,
    bus,
    backoff: { baseMs: 20, capMs: 100 },
  });
  listeners.push(listener);
  await listener.ready;
  return { bus, listener };
}

const lotId = (): string => randomUUID();

const closed = (lot: string, tenant = TENANT): LotNotification => {
  const n = toLotNotification(
    buildEvent('LotClosed', tenant, { lotId: lot, winnerId: null, finalAmount: null }),
  );
  if (n === null) throw new Error('LotClosed debe generar notificación');
  return n;
};

const notifyInTransaction = (n: LotNotification): Promise<void> =>
  db.prisma.$transaction((tx) => publishNotification(tx, n));

describe('canal LISTEN/NOTIFY', () => {
  it('una notificación publicada en una transacción llega al bus del oyente, intacta', async () => {
    const { bus } = await listen();
    const lot = lotId();
    const got: LotNotification[] = [];
    bus.subscribe(TENANT, lot, (n) => got.push(n));
    const n = closed(lot);
    await notifyInTransaction(n);
    await waitFor(() => got.length === 1, { description: 'la notificación' });
    expect(got[0]).toEqual(n);
  });

  it('dos oyentes (dos «réplicas») reciben ambos la misma notificación', async () => {
    const [a, b] = await Promise.all([listen(), listen()]);
    const lot = lotId();
    const gotA: LotNotification[] = [];
    const gotB: LotNotification[] = [];
    a.bus.subscribe(TENANT, lot, (n) => gotA.push(n));
    b.bus.subscribe(TENANT, lot, (n) => gotB.push(n));
    await notifyInTransaction(closed(lot));
    await waitFor(() => gotA.length === 1 && gotB.length === 1, { description: 'ambas réplicas' });
    expect(gotA[0]).toEqual(gotB[0]);
  });

  it('aislamiento por tenant: un suscriptor de otro tenant no recibe el lote', async () => {
    const { bus } = await listen();
    const lot = lotId();
    const mine: LotNotification[] = [];
    const foreign: LotNotification[] = [];
    bus.subscribe(TENANT, lot, (n) => mine.push(n));
    bus.subscribe(OTHER, lot, (n) => foreign.push(n));
    await notifyInTransaction(closed(lot));
    await waitFor(() => mine.length === 1, { description: 'la notificación' });
    await new Promise((r) => setTimeout(r, 300));
    expect(foreign).toHaveLength(0);
  });

  it('si la transacción se revierte, no se emite nada', async () => {
    const { bus } = await listen();
    const lot = lotId();
    const got: LotNotification[] = [];
    bus.subscribe(TENANT, lot, (n) => got.push(n));
    await expect(
      db.prisma.$transaction(async (tx) => {
        await publishNotification(tx, closed(lot));
        throw new Error('la transacción falla después de notificar');
      }),
    ).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 400));
    expect(got).toHaveLength(0);
  });

  it('las notificaciones de un mismo lote llegan en el orden en que se confirmaron', async () => {
    const { bus } = await listen();
    const lot = lotId();
    const order: string[] = [];
    bus.subscribe(TENANT, lot, (n) => order.push(n.eventId));
    const sent: string[] = [];
    for (let i = 0; i < 8; i++) {
      const n = closed(lot);
      sent.push(n.eventId);
      await notifyInTransaction(n);
    }
    await waitFor(() => order.length === 8, { description: 'las ocho notificaciones' });
    expect(order).toEqual(sent);
  });

  it('un contenido inválido (JSON roto o con otro formato) se descarta y el canal sigue funcionando', async () => {
    const { bus } = await listen();
    const lot = lotId();
    const got: LotNotification[] = [];
    bus.subscribe(TENANT, lot, (n) => got.push(n));
    await db.pool.query(`SELECT pg_notify('${NOTIFICATION_CHANNEL}', '{no es json')`);
    await db.pool.query(
      `SELECT pg_notify('${NOTIFICATION_CHANNEL}', '{"type":"BidPlaced","bidderId":"x"}')`,
    );
    await notifyInTransaction(closed(lot));
    await waitFor(() => got.length === 1, { description: 'la notificación válida' });
    expect(got).toHaveLength(1);
  });

  it('publishNotification rechaza una notificación con campos fuera del contrato', async () => {
    const bad = { ...closed(lotId()), bidderId: 'no-debe-salir' } as unknown as LotNotification;
    await expect(notifyInTransaction(bad)).rejects.toThrow();
  });

  it('tras cortar la conexión del oyente reconecta, avisa de resincronización y recibe las siguientes', async () => {
    const { bus, listener } = await listen();
    const lot = lotId();
    const got: LotNotification[] = [];
    let resyncs = 0;
    bus.subscribe(TENANT, lot, (n) => got.push(n));
    bus.onResync(() => (resyncs += 1));
    const before = listener.backendPid();
    expect(before).toBeDefined();

    await db.pool.query('SELECT pg_terminate_backend($1)', [before]);
    await waitFor(() => resyncs === 1, { description: 'la resincronización' });
    expect(listener.backendPid()).not.toBe(before);

    await notifyInTransaction(closed(lot));
    await waitFor(() => got.length === 1, { description: 'notificación tras reconectar' });
    expect(got).toHaveLength(1);
  });
});
