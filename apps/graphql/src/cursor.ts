import { primitives } from '@bidstream/domain';
import { z } from 'zod';
import { badInput } from './errors.js';

/**
 * Posición de una puja en el ranking `(amount DESC, placedAt, id)`: es la clave del *keyset* con el
 * que se pagina. El cursor es opaco para el cliente (base64url) y se valida estrictamente.
 */
const cursorSchema = z.strictObject({
  a: primitives.money,
  t: z.number().int().nonnegative(),
  i: primitives.uuid,
});

export interface BidCursor {
  readonly amount: string;
  readonly placedAt: Date;
  readonly id: string;
}

export function encodeCursor(cursor: BidCursor): string {
  return Buffer.from(
    JSON.stringify({ a: cursor.amount, t: cursor.placedAt.getTime(), i: cursor.id }),
  ).toString('base64url');
}

export function decodeCursor(value: string): BidCursor {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw badInput('cursor inválido');
  }
  const parsed = cursorSchema.safeParse(json);
  if (!parsed.success) throw badInput('cursor inválido');
  return { amount: parsed.data.a, placedAt: new Date(parsed.data.t), id: parsed.data.i };
}
