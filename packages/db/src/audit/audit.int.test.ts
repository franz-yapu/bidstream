import { randomUUID } from 'node:crypto';
import { buildEvent, partitionKey, type DomainEvent } from '@bidstream/domain';
import { createTestDatabase, type TestDatabase } from '@bidstream/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, recordAuditEntry } from '../index.js';

// La bitácora contra PostgreSQL real (base desechable).
const TENANT = '11111111-1111-4111-8111-111111111111';
const ANA = '44444444-4444-4444-8444-444444444444';
const T = '2026-11-12T20:00:00.000Z';

let db: TestDatabase;
let prisma: ReturnType<typeof createPrismaClient>;

beforeAll(async () => {
  db = await createTestDatabase();
  prisma = createPrismaClient(db.url);
});
afterAll(async () => {
  await prisma.$disconnect();
  await db.drop();
});

const id = (): string => randomUUID();
const lotId = id();
const auctionId = id();

/** Un evento de cada uno de los 7 tipos. */
const allTypes: DomainEvent[] = [
  buildEvent('AuctionOpened', TENANT, {
    auctionId,
    title: 'Arte',
    opensAt: T,
    closesAt: '2026-11-13T20:00:00.000Z',
  }),
  buildEvent('LotPublished', TENANT, {
    lotId,
    auctionId,
    title: 'Óleo',
    startingPrice: '100.00',
    minIncrement: '5.00',
    currency: 'USD',
    closesAt: '2026-11-13T20:00:00.000Z',
  }),
  buildEvent('BidPlaced', TENANT, { lotId, bidderId: ANA, amount: '100.00', placedAt: T }),
  buildEvent('BidRejected', TENANT, {
    lotId,
    bidderId: ANA,
    amount: '1.00',
    reason: 'BID_TOO_LOW',
  }),
  buildEvent('LotExtended', TENANT, {
    lotId,
    newClosesAt: '2026-11-13T20:05:00.000Z',
    reason: 'anti-sniping',
  }),
  buildEvent('LotClosed', TENANT, { lotId, winnerId: ANA, finalAmount: '100.00' }),
  buildEvent('AuctionClosed', TENANT, { auctionId }),
];

const record = (event: DomainEvent, offset = '7'): Promise<void> =>
  prisma.$transaction((tx) =>
    recordAuditEntry(tx, event, { topic: 'bidstream.events.lot', partition: 2, offset }),
  );

describe('recordAuditEntry', () => {
  it.each(allTypes.map((e) => [e.type, e] as const))(
    '%s: guarda el evento completo, la clave de partición y el origen en el log',
    async (_type, event) => {
      await record(event, '4242');
      const row = await prisma.auditLog.findUniqueOrThrow({ where: { eventId: event.eventId } });
      expect(row).toMatchObject({
        type: event.type,
        tenantId: TENANT,
        key: partitionKey(event),
        occurredAt: new Date(event.occurredAt),
        sourceTopic: 'bidstream.events.lot',
        sourcePartition: 2,
        sourceOffset: 4242n,
      });
      expect(row.payload).toEqual(JSON.parse(JSON.stringify(event)));
      expect(row.recordedAt).toBeInstanceOf(Date);
    },
  );

  it('un event_id repetido falla por clave primaria y no duplica', async () => {
    const event = buildEvent('AuctionClosed', TENANT, { auctionId: id() });
    await record(event);
    await expect(record(event)).rejects.toThrow();
    expect(await prisma.auditLog.count({ where: { eventId: event.eventId } })).toBe(1);
  });
});

describe('append-only', () => {
  const count = async (): Promise<number> => {
    const { rows } = await db.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM audit_log');
    return rows[0]?.n ?? 0;
  };

  it('UPDATE falla con la excepción del disparador y la fila no cambia', async () => {
    const event = allTypes[2] as DomainEvent;
    const before = await prisma.auditLog.findUniqueOrThrow({ where: { eventId: event.eventId } });
    await expect(
      db.pool.query(`UPDATE audit_log SET type = 'Manipulado' WHERE event_id = $1`, [
        event.eventId,
      ]),
    ).rejects.toThrow(/append-only/);
    const after = await prisma.auditLog.findUniqueOrThrow({ where: { eventId: event.eventId } });
    expect(after).toEqual(before);
  });

  it('DELETE y TRUNCATE fallan y el recuento no cambia', async () => {
    const before = await count();
    expect(before).toBeGreaterThan(0);
    await expect(db.pool.query('DELETE FROM audit_log')).rejects.toThrow(/append-only/);
    await expect(db.pool.query('TRUNCATE audit_log')).rejects.toThrow(/append-only/);
    expect(await count()).toBe(before);
  });

  it('el rechazo no se puede esquivar con una actualización «vacía» ni con un DELETE filtrado', async () => {
    const event = allTypes[0] as DomainEvent;
    await expect(
      db.pool.query(`UPDATE audit_log SET type = type WHERE event_id = $1`, [event.eventId]),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.pool.query('DELETE FROM audit_log WHERE event_id = $1', [event.eventId]),
    ).rejects.toThrow(/append-only/);
  });

  it('INSERT sigue permitido', async () => {
    const before = await count();
    await record(buildEvent('AuctionClosed', TENANT, { auctionId: id() }));
    expect(await count()).toBe(before + 1);
  });
});

describe('índices', () => {
  const plan = async (sql: string, params: unknown[]): Promise<string> => {
    const client = await db.pool.connect();
    try {
      await client.query('SET enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sql}`, params);
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    } finally {
      client.release();
    }
  };

  it('la consulta por tenant y tiempo usa su índice', async () => {
    expect(
      await plan('SELECT event_id FROM audit_log WHERE tenant_id = $1 ORDER BY occurred_at', [
        TENANT,
      ]),
    ).toContain('audit_log_tenant_id_occurred_at_idx');
  });

  it('la consulta por clave y tiempo usa su índice', async () => {
    expect(
      await plan('SELECT event_id FROM audit_log WHERE key = $1 ORDER BY occurred_at', [lotId]),
    ).toContain('audit_log_key_occurred_at_idx');
  });
});
