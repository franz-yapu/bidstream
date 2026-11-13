import { PrismaLotDecisionRepository, PrismaOutbox, type Prisma } from '@bidstream/db';
import {
  buildEvent,
  decideBid,
  decideCloseLot,
  evolveLot,
  parseMoney,
  type AntiSnipingConfig,
  type CommandOf,
  type DomainEvent,
  type EventDraft,
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

type Meta = { correlationId: string } | undefined;

const metaOf = (command: { meta?: { correlationId?: string | undefined } | undefined }): Meta =>
  command.meta?.correlationId === undefined
    ? undefined
    : { correlationId: command.meta.correlationId };

/**
 * Persiste una decisión (ADR-0011): guarda el nuevo estado del lote, encola los eventos en el outbox y
 * los marca como ya aplicados para el consumidor `state`, todo en la transacción que lo llama.
 */
async function commit(
  tx: Prisma.TransactionClient,
  tenantId: string,
  state: LotState,
  drafts: readonly EventDraft[],
  meta: Meta,
  deps: DecideDeps,
): Promise<DomainEvent[]> {
  if (drafts.length === 0) return [];
  const events = drafts.map((draft) =>
    buildEvent(draft.type, tenantId, draft.payload, { ...(meta === undefined ? {} : { meta }) }),
  );
  const next = events.reduce<LotState | undefined>(
    (current, event) => (current === undefined ? current : evolveLot(current, event)),
    state,
  );
  if (next !== undefined) await new PrismaLotDecisionRepository(tx).save(tenantId, next);
  await new PrismaOutbox(tx).enqueue(events, deps.eventsTopic);
  await tx.processedEvent.createMany({
    data: events.map((event) => ({ eventId: event.eventId, consumer: deps.stateConsumer })),
    skipDuplicates: true,
  });
  return events;
}

/**
 * Decide una puja: lee y bloquea el estado del lote, aplica `decideBid` con la hora de recepción del
 * comando y persiste la decisión. Devuelve los eventos emitidos.
 */
export async function decidePlaceBid(
  tx: Prisma.TransactionClient,
  command: CommandOf<'PlaceBid'>,
  deps: DecideDeps,
): Promise<DomainEvent[]> {
  const { lotId, bidderId, amount } = command.payload;
  const state = await new PrismaLotDecisionRepository(tx).findForUpdate(command.tenantId, lotId);
  if (state === null) throw new LotStateNotReady(lotId);
  const drafts = decideBid(
    state,
    { bidderId, amount: parseMoney(amount), placedAt: new Date(command.receivedAt) },
    deps.antiSniping,
  );
  return commit(tx, command.tenantId, state, drafts, metaOf(command), deps);
}

/**
 * Decide un cierre (D8): con la hora de recepción del comando, `decideCloseLot` emite `LotClosed` solo
 * si ya llegó `closesAt` (la señal puede adelantarse a una extensión por anti-sniping) y el lote sigue
 * abierto. Si no, no emite nada: la señal es idempotente.
 */
export async function decideCloseLotCommand(
  tx: Prisma.TransactionClient,
  command: CommandOf<'CloseLot'>,
  deps: DecideDeps,
): Promise<DomainEvent[]> {
  const state = await new PrismaLotDecisionRepository(tx).findForUpdate(
    command.tenantId,
    command.payload.lotId,
  );
  if (state === null) throw new LotStateNotReady(command.payload.lotId);
  const drafts = decideCloseLot(state, new Date(command.receivedAt));
  return commit(tx, command.tenantId, state, drafts, metaOf(command), deps);
}
