import { buildCommand, buildDepsFrom } from '@bidstream/domain';
import { requestHash, withTransaction } from '@bidstream/db';
import type { CommandContext, CommandDeps } from './deps.js';
import { BidRateLimited, IdempotencyKeyReused, LotNotFound } from './errors.js';

export const DEFAULT_BID_RATE_LIMIT_PER_MINUTE = 30;
const WINDOW_MS = 60_000;

export interface PlaceBidInput {
  readonly amount: string;
  /** Cabecera `Idempotency-Key` (C4): la misma clave y petición producen un solo comando. */
  readonly idempotencyKey: string;
}

export interface PlaceBidResult {
  readonly commandId: string;
  /** `true` si la clave ya existía: se devuelve el comando original sin crear otro. */
  readonly replayed: boolean;
}

/**
 * Acepta una puja (ADR-0003): comprueba que el lote existe en la proyección, reclama la clave de
 * idempotencia y escribe el comando `PlaceBid` en el outbox, todo en una sola transacción. **No
 * decide**: si la puja es válida, baja o llega tarde lo resuelve el decisor (ADR-0011) y el resultado
 * llega por evento (`BidPlaced`/`BidRejected`).
 */
export async function placeBid(
  deps: CommandDeps,
  tenantId: string,
  bidderId: string,
  lotId: string,
  input: PlaceBidInput,
  context: CommandContext = {},
): Promise<PlaceBidResult> {
  const command = buildCommand(
    'PlaceBid',
    tenantId,
    { lotId, bidderId, amount: input.amount },
    {
      deps: buildDepsFrom(deps.clock, deps.ids),
      ...(context.correlationId === undefined
        ? {}
        : { meta: { correlationId: context.correlationId } }),
    },
  );
  const limit = deps.bidRateLimitPerMinute ?? DEFAULT_BID_RATE_LIMIT_PER_MINUTE;
  const now = deps.clock.now();
  return withTransaction(deps.prisma, async ({ lots, outbox, idempotency }) => {
    if ((await lots.findById(tenantId, lotId)) === null) throw new LotNotFound(lotId);
    // Un postor a la vez: la cuenta del límite y la reserva de la clave son una sola decisión.
    await idempotency.lockBidder(tenantId, bidderId);
    const claim = await idempotency.claim({
      tenantId,
      bidderId,
      key: input.idempotencyKey,
      requestHash: requestHash({ lotId, amount: input.amount }),
      commandId: command.commandId,
      lotId,
      at: now,
    });
    if (claim.status === 'conflict') throw new IdempotencyKeyReused();
    if (claim.status === 'replayed') return { commandId: claim.commandId, replayed: true };

    // Solo cuenta una puja nueva: repetir una petición idempotente no gasta cupo. Si se supera el
    // límite, la excepción revierte la transacción y con ella la clave que se acaba de reservar.
    const since = new Date(now.getTime() - WINDOW_MS);
    if ((await idempotency.countSince(tenantId, bidderId, since)) > limit) {
      const oldest = await idempotency.oldestSince(tenantId, bidderId, since);
      const retryMs = oldest === null ? WINDOW_MS : oldest.getTime() + WINDOW_MS - now.getTime();
      throw new BidRateLimited(limit, Math.max(1, Math.ceil(retryMs / 1000)));
    }
    await outbox.enqueueCommand(command, deps.commandsTopic);
    return { commandId: command.commandId, replayed: false };
  });
}
