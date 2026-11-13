import {
  tryAcquireLeadership,
  withTransaction,
  type Leadership,
  type PrismaClient,
} from '@bidstream/db';
import {
  buildCommand,
  buildEvent,
  decideCloseAuction,
  type BuildCommandDeps,
} from '@bidstream/domain';
import { v7 as uuidv7 } from 'uuid';
import { deterministicUuidV7 } from './deterministic-id.js';

/** Clave del bloqueo asesor del `closer` (constante arbitraria, distinta de la del relay). */
export const CLOSER_LOCK_KEY = '7266451002';

export interface Logger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export interface CloserOptions {
  readonly prisma: Pick<PrismaClient, '$transaction'>;
  /** Conexión dedicada para el bloqueo asesor; obligatoria en `start()`. */
  readonly databaseUrl?: string;
  readonly commandsTopic: string;
  readonly eventsTopic: string;
  readonly now?: () => Date;
  readonly pollIntervalMs?: number;
  readonly standbyPollMs?: number;
  readonly batchSize?: number;
  /** Antigüedad a partir de la cual se borran las claves de idempotencia. */
  readonly idempotencyRetentionMs?: number;
  /** Cada cuánto se ejecuta esa limpieza (por defecto, 1 h). */
  readonly cleanupEveryMs?: number;
  readonly logger?: Logger;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface CloseRound {
  /** Lotes vencidos para los que se emitió `CloseLot` (los ya emitidos antes no se repiten). */
  readonly lotsSignalled: number;
  /** Subastas sin lotes abiertos para las que se emitió `AuctionClosed`. */
  readonly auctionsClosed: number;
  /** Claves de idempotencia caducadas que se borraron en esta ronda. */
  readonly keysDeleted: number;
}

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * El `closer` (D8, Q3): da la **señal de tiempo**. No decide cierres de lote: emite `CloseLot` por la
 * misma partición que las pujas y lo decide el decisor, que es el único escritor de cada lote
 * (ADR-0011). Sí emite `AuctionClosed` cuando una subasta vencida se queda sin lotes abiertos.
 * Todo es idempotente: los ids de las señales son deterministas y el outbox deduplica por clave.
 */
export class Closer {
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly batchSize: number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly abort = new AbortController();
  private loop: Promise<void> | undefined;
  private stopping = false;
  private lastCleanup = 0;

  constructor(private readonly options: CloserOptions) {
    this.logger = options.logger ?? silent;
    this.now = options.now ?? ((): Date => new Date());
    this.batchSize = options.batchSize ?? 100;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** Una ronda: señales de cierre de lote, cierre de subastas y, de vez en cuando, limpieza. */
  async runOnce(): Promise<CloseRound> {
    const now = this.now();
    const deps: BuildCommandDeps = { newId: () => uuidv7(), now: () => now };
    const cleanupEvery = this.options.cleanupEveryMs ?? 3_600_000;
    const cleanup = now.getTime() - this.lastCleanup >= cleanupEvery;

    const round = await withTransaction(
      this.options.prisma,
      async ({ outbox, auctions, closing, idempotency }) => {
        const dueLots = await closing.findDueLots(now, this.batchSize);
        for (const lot of dueLots) {
          const command = buildCommand(
            'CloseLot',
            lot.tenantId,
            { lotId: lot.lotId },
            {
              deps,
              commandId: deterministicUuidV7(
                `close-lot:${lot.lotId}:${lot.closesAt.toISOString()}`,
              ),
            },
          );
          await outbox.enqueueCommand(command, this.options.commandsTopic, {
            skipDuplicates: true,
          });
        }

        let auctionsClosed = 0;
        for (const due of await closing.findDueAuctions(now, this.batchSize)) {
          const state = await auctions.findById(due.tenantId, due.auctionId);
          if (state === null) continue;
          for (const draft of decideCloseAuction(state)) {
            if (draft.type !== 'AuctionClosed') continue;
            const event = buildEvent('AuctionClosed', due.tenantId, draft.payload, {
              deps: {
                newId: () => deterministicUuidV7(`auction-closed:${due.auctionId}`),
                now: () => now,
              },
            });
            await outbox.enqueue([event], this.options.eventsTopic, { skipDuplicates: true });
            auctionsClosed += 1;
          }
        }

        const keysDeleted = cleanup
          ? await idempotency.deleteOlderThan(
              new Date(now.getTime() - (this.options.idempotencyRetentionMs ?? 86_400_000)),
            )
          : 0;
        return { lotsSignalled: dueLots.length, auctionsClosed, keysDeleted };
      },
    );
    if (cleanup) this.lastCleanup = now.getTime();
    if (round.lotsSignalled > 0 || round.auctionsClosed > 0 || round.keysDeleted > 0) {
      this.logger.info({ ...round }, 'ronda del closer');
    }
    return round;
  }

  private async work(leadership: Leadership): Promise<void> {
    while (!this.stopping && !leadership.lost) {
      try {
        await this.runOnce();
      } catch (error) {
        this.logger.error({ err: error }, 'el closer no pudo completar la ronda; se reintenta');
      }
      await this.sleep(this.options.pollIntervalMs ?? 5_000, this.abort.signal);
    }
  }

  /** Empieza a trabajar mientras sea el líder. Resuelve cuando se llama a `stop()`. */
  start(): Promise<void> {
    const url = this.options.databaseUrl;
    if (url === undefined) throw new Error('CloserOptions.databaseUrl es obligatorio en start()');
    this.loop = (async () => {
      while (!this.stopping) {
        let leadership: Leadership | null = null;
        try {
          leadership = await tryAcquireLeadership(url, CLOSER_LOCK_KEY);
        } catch (error) {
          this.logger.error({ err: error }, 'no se pudo comprobar el liderazgo');
        }
        if (leadership === null) {
          await this.sleep(this.options.standbyPollMs ?? 5_000, this.abort.signal);
          continue;
        }
        this.logger.info({}, 'liderazgo adquirido: este closer da la señal de tiempo');
        try {
          await this.work(leadership);
        } finally {
          await leadership.release();
          this.logger.info({}, 'liderazgo liberado');
        }
      }
    })();
    return this.loop;
  }

  /** Apagado ordenado: termina la ronda en curso y suelta el liderazgo. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.abort.abort();
    await this.loop;
  }
}
