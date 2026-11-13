import { buildDepsFrom, buildEvent, parseMoney } from '@bidstream/domain';
import { withTransaction } from '@bidstream/db';
import type { CommandContext, CommandDeps } from './deps.js';
import { AuctionClosed, AuctionNotFound, InvalidCommand } from './errors.js';

export interface PublishLotInput {
  readonly title: string;
  readonly startingPrice: string;
  readonly minIncrement: string;
  readonly currency: string;
  readonly closesAt: string;
}

export interface PublishLotResult {
  readonly lotId: string;
  readonly auctionId: string;
}

/**
 * Acepta la publicación de un lote en una subasta abierta. Comprueba la subasta en la
 * **proyección** (spec §5), que es eventualmente consistente: justo tras crearla puede no estar.
 * El cierre del lote no se limita al de la subasta: el anti-sniping puede extenderlo.
 */
export async function publishLot(
  deps: CommandDeps,
  tenantId: string,
  auctionId: string,
  input: PublishLotInput,
  context: CommandContext = {},
): Promise<PublishLotResult> {
  // Reglas que no necesitan la base de datos, primero.
  if (Date.parse(input.closesAt) <= deps.clock.now().getTime()) {
    throw new InvalidCommand('closesAt debe estar en el futuro');
  }
  if (parseMoney(input.startingPrice) <= 0n) {
    throw new InvalidCommand('startingPrice debe ser mayor que cero');
  }
  if (parseMoney(input.minIncrement) <= 0n) {
    throw new InvalidCommand('minIncrement debe ser mayor que cero');
  }

  const lotId = deps.ids.newId();
  const eventDeps = buildDepsFrom(deps.clock, deps.ids);

  await withTransaction(deps.prisma, async ({ auctions, outbox }) => {
    const auction = await auctions.findById(tenantId, auctionId);
    if (auction === null) throw new AuctionNotFound(auctionId);
    if (auction.status === 'closed') throw new AuctionClosed(auctionId);
    const event = buildEvent(
      'LotPublished',
      tenantId,
      {
        lotId,
        auctionId,
        title: input.title,
        startingPrice: input.startingPrice,
        minIncrement: input.minIncrement,
        currency: input.currency,
        closesAt: input.closesAt,
      },
      {
        deps: eventDeps,
        ...(context.correlationId === undefined
          ? {}
          : { meta: { correlationId: context.correlationId } }),
      },
    );
    await outbox.enqueue([event], deps.eventsTopic);
  });
  return { lotId, auctionId };
}
