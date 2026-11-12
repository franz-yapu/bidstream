import { buildDepsFrom, buildEvent } from '@bidstream/domain';
import { withTransaction } from '@bidstream/db';
import type { CommandDeps } from './deps.js';
import { InvalidCommand } from './errors.js';

export interface OpenAuctionInput {
  readonly title: string;
  readonly opensAt: string;
  readonly closesAt: string;
}

export interface OpenAuctionResult {
  readonly auctionId: string;
}

/**
 * Acepta la apertura de una subasta: valida y escribe `AuctionOpened` en el outbox, en una sola
 * transacción. El estado visible llega después, cuando el `projector` procesa el evento.
 */
export async function openAuction(
  deps: CommandDeps,
  tenantId: string,
  input: OpenAuctionInput,
): Promise<OpenAuctionResult> {
  if (Date.parse(input.closesAt) <= deps.clock.now().getTime()) {
    throw new InvalidCommand('closesAt debe estar en el futuro');
  }
  const auctionId = deps.ids.newId();
  const event = buildEvent(
    'AuctionOpened',
    tenantId,
    { auctionId, title: input.title, opensAt: input.opensAt, closesAt: input.closesAt },
    { deps: buildDepsFrom(deps.clock, deps.ids) },
  );
  await withTransaction(deps.prisma, ({ outbox }) => outbox.enqueue([event], deps.eventsTopic));
  return { auctionId };
}
