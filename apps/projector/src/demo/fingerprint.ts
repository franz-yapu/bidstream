import { createHash } from 'node:crypto';
import type { PrismaClient } from '@bidstream/db';

const isDecimalLike = (v: object): v is { toFixed(): string } =>
  typeof (v as { toFixed?: unknown }).toFixed === 'function';

/** Serialización canónica: claves ordenadas, `bigint`/`Decimal`/`Date` como texto. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'bigint') return v.toString();
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      if (isDecimalLike(v)) return v.toFixed();
      return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}

/** Huella estable de un conjunto de filas: no depende del orden en que lleguen. */
export function fingerprintRows(rows: Record<string, readonly unknown[]>): string {
  const sorted = Object.fromEntries(
    Object.entries(rows)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([table, list]) => [table, list.map(canonicalJson).sort()]),
  );
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

export interface ProjectionSnapshot {
  readonly auctions: number;
  readonly lots: number;
  readonly bids: number;
  readonly awarded: number;
  readonly fingerprint: string;
}

/** Cuenta y calcula la huella de la proyección (`auction`, `lot`, `bid`). */
export async function snapshotProjection(
  prisma: Pick<PrismaClient, 'auction' | 'lot' | 'bid'>,
): Promise<ProjectionSnapshot> {
  const [auctions, lots, bids] = await Promise.all([
    prisma.auction.findMany(),
    prisma.lot.findMany(),
    prisma.bid.findMany(),
  ]);
  return {
    auctions: auctions.length,
    lots: lots.length,
    bids: bids.length,
    awarded: bids.filter((b) => b.awarded).length,
    fingerprint: fingerprintRows({ auctions, lots, bids }),
  };
}
