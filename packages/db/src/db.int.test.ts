import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { compareBids, parseMoney } from '@bidstream/domain';
import { createTestDatabase, type TestDatabase } from '@bidstream/testing';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LotStatus, AuctionStatus } from './index.js';

// Pruebas contra el PostgreSQL de `make up`, sobre una base de datos desechable por ejecución
// (utilidades de @bidstream/testing).
const packageDir = resolve(import.meta.dirname, '..');

let testDb: TestDatabase;
let db: pg.Pool;
let prisma: TestDatabase['prisma'];
let testUrl: string;

const TENANT = '11111111-1111-4111-8111-111111111111';
const id = (): string => randomUUID();

async function insertLot(lotId = id()): Promise<string> {
  const auctionId = id();
  await db.query(
    `INSERT INTO auction (id, tenant_id, title, opens_at, closes_at, status)
     VALUES ($1, $2, 'a', now(), now() + interval '1 day', 'OPEN')`,
    [auctionId, TENANT],
  );
  await db.query(
    `INSERT INTO lot (id, auction_id, tenant_id, title, starting_price, min_increment, currency,
                      closes_at, status)
     VALUES ($1, $2, $3, 'l', 100, 5, 'USD', now() + interval '1 day', 'OPEN')`,
    [lotId, auctionId, TENANT],
  );
  return lotId;
}

async function insertBid(
  lotId: string,
  amount: string,
  placedAt: string,
  extra: { id?: string; awarded?: boolean } = {},
): Promise<string> {
  const bidId = extra.id ?? id();
  await db.query(
    `INSERT INTO bid (id, lot_id, bidder_id, amount, placed_at, awarded)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [bidId, lotId, id(), amount, placedAt, extra.awarded ?? false],
  );
  return bidId;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = testDb.pool;
  prisma = testDb.prisma;
  testUrl = testDb.url;
});

afterAll(async () => {
  await testDb.drop();
});

describe('migración inicial', () => {
  it('se aplica desde una base vacía y `migrate status` queda al día', () => {
    const out = execFileSync('npx', ['prisma', 'migrate', 'status'], {
      cwd: packageDir,
      env: { ...process.env, DATABASE_URL: testUrl },
      encoding: 'utf8',
    });
    expect(out).toContain('Database schema is up to date');
  });

  it('crea las tablas de la spec y la bitácora', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' ORDER BY 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'auction',
      'audit_log',
      'bid',
      'lot',
      'lot_decision',
      'outbox_message',
      'processed_event',
    ]);
  });
});

describe('dinero: Decimal(12,2)', () => {
  it('guarda exacto y sin flotantes a través de Prisma', async () => {
    const lotId = id();
    const auctionId = id();
    await prisma.auction.create({
      data: {
        id: auctionId,
        tenantId: TENANT,
        title: 'a',
        opensAt: new Date(),
        closesAt: new Date(Date.now() + 86_400_000),
        status: AuctionStatus.OPEN,
      },
    });
    await prisma.lot.create({
      data: {
        id: lotId,
        auctionId,
        tenantId: TENANT,
        title: 'l',
        startingPrice: '100.10',
        minIncrement: '0.20',
        currency: 'USD',
        closesAt: new Date(Date.now() + 86_400_000),
        status: LotStatus.OPEN,
      },
    });
    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
    expect(lot.startingPrice.toString()).toBe('100.1');
    expect(lot.startingPrice.plus(lot.minIncrement).toString()).toBe('100.3');
  });

  it('SQL suma 0.1 + 0.2 = 0.30 exacto', async () => {
    const { rows } = await db.query<{ s: string }>(
      'SELECT (0.1::numeric(12,2) + 0.2::numeric(12,2))::text AS s',
    );
    expect(rows[0]?.s).toBe('0.30');
  });

  it('redondea a 2 decimales y rechaza más de 10 enteros', async () => {
    const lotId = await insertLot();
    await insertBid(lotId, '10.505', '2026-11-12T19:00:00Z');
    const { rows } = await db.query<{ amount: string }>(
      'SELECT amount::text FROM bid WHERE lot_id = $1',
      [lotId],
    );
    expect(rows[0]?.amount).toBe('10.51');
    await expect(insertBid(lotId, '12345678901', '2026-11-12T19:00:00Z')).rejects.toThrow(
      /overflow/i,
    );
  });
});

describe('adjudicación única (índice único parcial)', () => {
  it('una segunda puja adjudicada del mismo lote falla; varias no adjudicadas conviven', async () => {
    const lotId = await insertLot();
    await insertBid(lotId, '100', '2026-11-12T19:00:00Z');
    await insertBid(lotId, '105', '2026-11-12T19:01:00Z');
    await insertBid(lotId, '110', '2026-11-12T19:02:00Z', { awarded: true });
    await expect(
      insertBid(lotId, '120', '2026-11-12T19:03:00Z', { awarded: true }),
    ).rejects.toThrow(/bid_one_awarded_per_lot_idx/);
  });

  it('otro lote sí puede tener su propia puja adjudicada', async () => {
    const a = await insertLot();
    const b = await insertLot();
    await insertBid(a, '100', '2026-11-12T19:00:00Z', { awarded: true });
    await expect(
      insertBid(b, '100', '2026-11-12T19:00:00Z', { awarded: true }),
    ).resolves.toBeTypeOf('string');
  });
});

describe('idempotencia', () => {
  it('ProcessedEvent: el mismo evento lo registran dos consumidores, pero no dos veces el mismo', async () => {
    const eventId = id();
    const ins = (consumer: string): Promise<unknown> =>
      db.query('INSERT INTO processed_event (event_id, consumer) VALUES ($1, $2)', [
        eventId,
        consumer,
      ]);
    await ins('projector');
    await ins('notifier');
    await expect(ins('projector')).rejects.toThrow(/processed_event_pkey/);
  });

  it('Bid: el mismo id (eventId del BidPlaced) no se inserta dos veces', async () => {
    const lotId = await insertLot();
    const bidId = id();
    await insertBid(lotId, '100', '2026-11-12T19:00:00Z', { id: bidId });
    await expect(insertBid(lotId, '100', '2026-11-12T19:00:00Z', { id: bidId })).rejects.toThrow(
      /bid_pkey/,
    );
  });
});

describe('índices', () => {
  it('el orden SQL del ranking coincide con compareBids del dominio, incluidos los empates', async () => {
    const lotId = await insertLot();
    const rows = [
      { amount: '120.00', at: '2026-11-12T19:05:00Z' },
      { amount: '150.00', at: '2026-11-12T19:09:00Z' },
      { amount: '150.00', at: '2026-11-12T19:02:00Z' },
      { amount: '150.00', at: '2026-11-12T19:02:00Z' },
      { amount: '90.00', at: '2026-11-12T19:00:00Z' },
    ];
    for (const r of rows) await insertBid(lotId, r.amount, r.at);

    const sql = await db.query<{ id: string; amount: string; placed_at: Date }>(
      'SELECT id, amount::text AS amount, placed_at FROM bid WHERE lot_id = $1 ORDER BY bid.amount DESC, bid.placed_at, bid.id',
      [lotId],
    );
    const label = (r: { id: string; amount: string; placed_at: Date }): string =>
      `${r.amount} ${r.placed_at.toISOString()} ${r.id}`;
    const domain = [...sql.rows]
      .sort((x, y) =>
        compareBids(
          { id: x.id, amount: parseMoney(x.amount), placedAt: x.placed_at },
          { id: y.id, amount: parseMoney(y.amount), placedAt: y.placed_at },
        ),
      )
      .map(label);
    expect(sql.rows.map(label)).toEqual(domain);
  });

  it('la consulta de ranking usa el índice compuesto', async () => {
    const lotId = await insertLot();
    await insertBid(lotId, '100', '2026-11-12T19:00:00Z');
    const client = await db.connect();
    try {
      await client.query('SET enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        'EXPLAIN SELECT id FROM bid WHERE lot_id = $1 ORDER BY amount DESC, placed_at, id',
        [lotId],
      );
      expect(rows.map((r) => r['QUERY PLAN']).join('\n')).toContain('bid_ranking_idx');
    } finally {
      client.release();
    }
  });

  it('la consulta del relay usa el índice parcial de pendientes', async () => {
    const client = await db.connect();
    try {
      await client.query('SET enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        'EXPLAIN SELECT id FROM outbox_message WHERE published_at IS NULL ORDER BY created_at LIMIT 100',
      );
      expect(rows.map((r) => r['QUERY PLAN']).join('\n')).toContain('outbox_message_pending_idx');
    } finally {
      client.release();
    }
  });
});
