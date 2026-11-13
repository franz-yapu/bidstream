import { PrismaLotDecisionRepository, PrismaOutbox, type Prisma } from '@bidstream/db';
import {
  buildEvent,
  decideBid,
  evolveLot,
  parseMoney,
  type AntiSnipingConfig,
  type CommandOf,
  type DomainEvent,
  type LotState,
} from '@bidstream/domain';

/** Consumidor que mantiene `lot_decision` con los eventos de otros productores (`LotPublished`…). */
export const DECIDER_STATE_CONSUMER = 'decider-state';

/**
 * El decisor aún no conoce el lote (va por detrás del log en `LotPublished`). **No** es un rechazo
 * de negocio: el procesador reintenta con espera y, agotados los intentos, el comando va al DLQ,
 * desde donde se puede reprocesar (D7).
 */
export class LotStateNotReady extends Error {
  override readonly name = 'LotStateNotReady';
  constructor(lotId: string) {
    super(`el lote ${lotId} todavía no tiene estado de decisión`);
  }
}

export interface DecideDeps {
  readonly antiSniping: AntiSnipingConfig;
  /** Topic al que van los eventos resultantes (`bidstream.events.lot`). */
  readonly eventsTopic: string;
  /**
   * Nombre del consumidor `state` (su grupo): los eventos propios se marcan como ya aplicados para
   * ese nombre. Si no coincidiera con el grupo real, el consumidor volvería a aplicarlos y
   * retrocedería el estado.
   */
  readonly stateConsumer: string;
}

/**
 * Decide una puja (ADR-0011): lee y bloquea el estado del lote, aplica `decideBid` con la hora de
 * recepción del comando, y en la **misma transacción** guarda el nuevo estado, encola los eventos
 * en el outbox y los marca como ya aplicados para `decider-state` (así ese consumidor no los repite).
 * Devuelve los eventos emitidos.
 */
export async function decidePlaceBid(
  tx: Prisma.TransactionClient,
  command: CommandOf<'PlaceBid'>,
  deps: DecideDeps,
): Promise<DomainEvent[]> {
  const { lotId, bidderId, amount } = command.payload;
  const decisions = new PrismaLotDecisionRepository(tx);
  const state = await decisions.findForUpdate(command.tenantId, lotId);
  if (state === null) throw new LotStateNotReady(lotId);

  const drafts = decideBid(
    state,
    { bidderId, amount: parseMoney(amount), placedAt: new Date(command.receivedAt) },
    deps.antiSniping,
  );
  const meta =
    command.meta?.correlationId === undefined
      ? undefined
      : { correlationId: command.meta.correlationId };
  const events = drafts.map((draft) =>
    buildEvent(draft.type, command.tenantId, draft.payload, {
      ...(meta === undefined ? {} : { meta }),
    }),
  );

  const next = events.reduce<LotState | undefined>(
    (current, event) => (current === undefined ? current : evolveLot(current, event)),
    state,
  );
  if (next !== undefined) await decisions.save(command.tenantId, next);
  await new PrismaOutbox(tx).enqueue(events, deps.eventsTopic);
  await tx.processedEvent.createMany({
    data: events.map((event) => ({ eventId: event.eventId, consumer: deps.stateConsumer })),
    skipDuplicates: true,
  });
  return events;
}
