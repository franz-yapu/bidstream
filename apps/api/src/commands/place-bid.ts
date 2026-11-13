import { buildCommand, buildDepsFrom } from '@bidstream/domain';
import { withTransaction } from '@bidstream/db';
import type { CommandContext, CommandDeps } from './deps.js';
import { LotNotFound } from './errors.js';

export interface PlaceBidInput {
  readonly amount: string;
}

export interface PlaceBidResult {
  readonly commandId: string;
}

/**
 * Acepta una puja (ADR-0003): comprueba que el lote existe en la proyección y escribe el comando
 * `PlaceBid` en el outbox, en una sola transacción. **No decide**: si la puja es válida, baja o llega
 * tarde lo resuelve el decisor (ADR-0011) y el resultado llega por evento (`BidPlaced`/`BidRejected`).
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
  await withTransaction(deps.prisma, async ({ lots, outbox }) => {
    if ((await lots.findById(tenantId, lotId)) === null) throw new LotNotFound(lotId);
    await outbox.enqueueCommand(command, deps.commandsTopic);
  });
  return { commandId: command.commandId };
}
