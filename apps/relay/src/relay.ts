import { PrismaOutbox, type PendingOutboxMessage, type PrismaClient } from '@bidstream/db';
import { signatureHeaders, type SigningKey } from '@bidstream/signing';
import { backoffDelay, DEFAULT_BACKOFF, type BackoffPolicy } from './backoff.js';
import { tryAcquireLeadership, type Leadership } from './leader.js';

export interface PublishRequest {
  readonly topic: string;
  readonly key: string;
  readonly value: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface Logger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export interface RunOnceResult {
  /** Mensajes publicados **y confirmados** (marcados) en esta ronda. */
  readonly published: number;
  /** Fallo de Kafka o de la base de datos: lo ya confirmado se conserva y la ronda siguiente continúa. */
  readonly error?: unknown;
}

export interface RelayOptions {
  readonly prisma: Pick<PrismaClient, '$transaction'>;
  readonly publish: (request: PublishRequest) => Promise<void>;
  /** Conexión dedicada para el bloqueo asesor; obligatoria en `start()`. */
  readonly databaseUrl?: string;
  /** Clave de firma (F3): si está, cada mensaje se firma con Ed25519 antes de publicarse. */
  readonly signer?: SigningKey | null;
  readonly batchSize?: number;
  readonly pollIntervalMs?: number;
  readonly standbyPollMs?: number;
  readonly backoff?: BackoffPolicy;
  readonly transactionTimeoutMs?: number;
  readonly logger?: Logger;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly random?: () => number;
  readonly onBatch?: (result: RunOnceResult) => void;
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

function toRequest(row: PendingOutboxMessage, signer: SigningKey | null): PublishRequest {
  const payload = (typeof row.payload === 'object' && row.payload !== null ? row.payload : {}) as {
    type?: unknown;
    version?: unknown;
    meta?: { correlationId?: unknown } | null;
  };
  const correlationId = payload.meta?.correlationId;
  const value = JSON.stringify(row.payload);
  return {
    topic: row.topic,
    key: row.key,
    value,
    headers: {
      // se firman los bytes exactos que se publican (F3)
      ...(signer === null ? {} : signatureHeaders(value, signer)),
      eventId: row.id,
      ...(typeof payload.type === 'string' ? { type: payload.type } : {}),
      ...(typeof payload.version === 'number' ? { version: String(payload.version) } : {}),
      ...(typeof correlationId === 'string' && correlationId !== '' ? { correlationId } : {}),
    },
  };
}

/**
 * Relay del outbox: publica en Kafka lo que la API escribió en `outbox_message`, **en orden** y
 * **al menos una vez**. Solo un relay está activo a la vez (bloqueo asesor) para no perder el orden
 * por lote al repartir el trabajo (ADR-0001, docs/sdd/D1/SDD.md §2.2).
 */
export class OutboxRelay {
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly standbyPollMs: number;
  private readonly backoff: BackoffPolicy;
  private readonly timeout: number;
  private readonly logger: Logger;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly abort = new AbortController();
  private loop: Promise<void> | undefined;
  private stopping = false;

  constructor(private readonly options: RelayOptions) {
    this.batchSize = options.batchSize ?? 100;
    this.pollIntervalMs = options.pollIntervalMs ?? 200;
    this.standbyPollMs = options.standbyPollMs ?? 5_000;
    this.backoff = options.backoff ?? DEFAULT_BACKOFF;
    this.timeout = options.transactionTimeoutMs ?? 30_000;
    this.logger = options.logger ?? silent;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  /**
   * Una ronda: reclama un lote, lo publica **sin saltarse ninguno** y marca lo publicado, todo en una
   * transacción. Si Kafka falla en el mensaje *n*, las anteriores se confirman y la ronda siguiente
   * continúa desde la *n*.
   */
  async runOnce(): Promise<RunOnceResult> {
    const confirmed: string[] = [];
    let publishError: unknown;
    try {
      await this.options.prisma.$transaction(
        async (tx) => {
          const outbox = new PrismaOutbox(tx);
          const rows = await outbox.claimPending(this.batchSize);
          const done: string[] = [];
          for (const row of rows) {
            try {
              const request = toRequest(row, this.options.signer ?? null);
              await this.options.publish(request);
              done.push(row.id);
              this.logger.info(
                {
                  eventId: row.id,
                  type: request.headers['type'],
                  correlationId: request.headers['correlationId'],
                  topic: request.topic,
                },
                'evento publicado',
              );
            } catch (error) {
              publishError = error;
              break;
            }
          }
          await outbox.markPublished(done);
          confirmed.push(...done);
        },
        { timeout: this.timeout },
      );
    } catch (error) {
      // Falló la base de datos (p. ej. al marcar): la transacción se revirtió, nada quedó
      // confirmado y lo publicado se volverá a publicar (al menos una vez).
      const result: RunOnceResult = { published: 0, error };
      this.options.onBatch?.(result);
      return result;
    }
    const result: RunOnceResult = {
      published: confirmed.length,
      ...(publishError === undefined ? {} : { error: publishError }),
    };
    this.options.onBatch?.(result);
    return result;
  }

  /** Bucle de trabajo mientras seamos el líder. */
  private async work(leadership: Leadership): Promise<void> {
    let failures = 0;
    while (!this.stopping && !leadership.lost) {
      const result = await this.runOnce();
      if (result.error !== undefined) {
        failures += 1;
        const delay = backoffDelay(failures, this.backoff, this.random);
        this.logger.error(
          { err: result.error, failures, retryInMs: delay, published: result.published },
          'el relay no pudo publicar; se reintenta con backoff',
        );
        await this.sleep(delay, this.abort.signal);
      } else {
        failures = 0;
        if (result.published === 0) await this.sleep(this.pollIntervalMs, this.abort.signal);
      }
    }
  }

  /** Empieza a trabajar. Resuelve cuando se llama a `stop()`. */
  start(): Promise<void> {
    const url = this.options.databaseUrl;
    if (url === undefined) throw new Error('RelayOptions.databaseUrl es obligatorio en start()');
    this.loop = (async () => {
      while (!this.stopping) {
        let leadership: Leadership | null = null;
        try {
          leadership = await tryAcquireLeadership(url);
        } catch (error) {
          this.logger.error({ err: error }, 'no se pudo comprobar el liderazgo');
        }
        if (leadership === null) {
          await this.sleep(this.standbyPollMs, this.abort.signal);
          continue;
        }
        this.logger.info({}, 'liderazgo adquirido: este relay publica');
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

  /** Apagado ordenado: termina la ronda en curso, marca lo publicado y suelta el liderazgo. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.abort.abort();
    await this.loop;
  }
}
