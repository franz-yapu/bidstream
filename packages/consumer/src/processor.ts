import { parseCommand, parseEvent, type DomainCommand, type DomainEvent } from '@bidstream/domain';
import type { Prisma, PrismaClient } from '@bidstream/db';
import type { IncomingMessage } from '@bidstream/kafka';
import { backoffDelay, DEFAULT_RETRY_POLICY, type RetryPolicy } from './backoff.js';
import { buildDlqMessage, type DlqReason } from './dlq.js';

export interface HandlerContext {
  /** Transacción en la que también se registra el evento procesado; los consumidores sin base de datos la ignoran. */
  readonly tx: Prisma.TransactionClient;
  readonly message: IncomingMessage;
}

export type EventHandler<T = DomainEvent> = (item: T, context: HandlerContext) => Promise<void>;

/** Lo que el procesador necesita saber de un mensaje ya validado, sea evento o comando. */
export interface ParsedMessage<T> {
  readonly value: T;
  /** `eventId` o `commandId`: junto al consumidor, la clave de idempotencia. */
  readonly id: string;
  readonly type: string;
  readonly correlationId?: string | undefined;
}

/** Cómo se valida un tipo de mensaje del log (eventos o comandos). */
export interface MessageCodec<T> {
  /** «evento» o «comando»: solo para los mensajes de error. */
  readonly noun: string;
  parse(
    json: unknown,
  ): { success: true; parsed: ParsedMessage<T> } | { success: false; summary: string };
}

const summarize = (issues: readonly { path: PropertyKey[]; message: string }[]): string =>
  issues
    .slice(0, 5)
    .map((i) => `${i.path.map(String).join('.') || '(raíz)'}: ${i.message}`)
    .join('; ');

/** Los eventos de dominio de `bidstream.events.lot`. */
export const eventCodec: MessageCodec<DomainEvent> = {
  noun: 'evento',
  parse: (json) => {
    const result = parseEvent(json);
    return result.success
      ? {
          success: true,
          parsed: {
            value: result.event,
            id: result.event.eventId,
            type: result.event.type,
            correlationId: result.event.meta?.correlationId,
          },
        }
      : { success: false, summary: summarize(result.error.issues) };
  },
};

/** Los comandos de `bidstream.commands.bid`. */
export const commandCodec: MessageCodec<DomainCommand> = {
  noun: 'comando',
  parse: (json) => {
    const result = parseCommand(json);
    return result.success
      ? {
          success: true,
          parsed: {
            value: result.command,
            id: result.command.commandId,
            type: result.command.type,
            correlationId: result.command.meta?.correlationId,
          },
        }
      : { success: false, summary: summarize(result.error.issues) };
  },
};

/** Id de correlación que el relay copia a la cabecera `correlationId` (F4). */
function headerCorrelation(message: IncomingMessage): string | undefined {
  const value = message.headers['correlationId'];
  return value !== undefined && value !== '' && value.length <= 128 ? value : undefined;
}

export interface Logger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export type ProcessOutcome =
  | { readonly kind: 'processed'; readonly attempts: number }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'dead-lettered'; readonly reason: DlqReason; readonly attempts: number };

export interface DlqPublication {
  readonly key: string | null;
  readonly value: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface ProcessorDeps<T = DomainEvent> {
  readonly prisma: Pick<PrismaClient, '$transaction'>;
  /** Nombre del consumidor: junto al `eventId` es la clave de idempotencia (`ProcessedEvent`). */
  readonly consumerName: string;
  readonly handler: EventHandler<T>;
  /** Por defecto, los eventos de dominio. */
  readonly codec?: MessageCodec<T>;
  readonly publishDlq: (publication: DlqPublication) => Promise<void>;
  readonly retry?: Partial<RetryPolicy>;
  /** Punto de enganche para la firma de eventos (F3): `false` trata el mensaje como veneno. */
  readonly verify?: (message: IncomingMessage, value: T) => boolean | Promise<boolean>;
  readonly transactionTimeoutMs?: number;
  readonly logger?: Logger;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly now?: () => Date;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Procesa un mensaje: valida, aplica idempotencia, reintenta y, si no hay forma, lo aparta al DLQ.
 * Resuelve cuando el offset puede confirmarse; **lanza** solo si el DLQ no se pudo escribir (el
 * mensaje no debe confirmarse y se volverá a entregar: nunca se pierde un evento).
 */
export function createMessageProcessor<T = DomainEvent>(
  deps: ProcessorDeps<T>,
): (message: IncomingMessage) => Promise<ProcessOutcome> {
  const codec = (deps.codec ?? eventCodec) as MessageCodec<T>;
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...deps.retry };
  const logger = deps.logger ?? silentLogger;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const now = deps.now ?? ((): Date => new Date());
  const timeout = deps.transactionTimeoutMs ?? 5_000;

  async function deadLetter(
    message: IncomingMessage,
    error: unknown,
    attempts: number,
    reason: DlqReason,
    eventId: string | undefined,
    correlationId: string | undefined,
  ): Promise<ProcessOutcome> {
    const dlq = buildDlqMessage({
      message,
      consumer: deps.consumerName,
      error,
      attempts,
      reason,
      now: now(),
      correlationId,
    });
    await deps.publishDlq({
      key: message.key,
      value: JSON.stringify(dlq),
      headers: {
        consumer: deps.consumerName,
        reason,
        ...(eventId === undefined ? {} : { eventId }),
        ...(correlationId === undefined ? {} : { correlationId }),
      },
    });
    logger.error(
      {
        consumer: deps.consumerName,
        reason,
        attempts,
        eventId,
        correlationId,
        topic: message.topic,
        offset: message.offset,
      },
      'evento apartado al DLQ',
    );
    return { kind: 'dead-lettered', reason, attempts };
  }

  /** Una transacción: registra el evento (idempotencia) y ejecuta el handler. */
  async function attempt(
    event: T,
    id: string,
    message: IncomingMessage,
  ): Promise<'processed' | 'duplicate'> {
    return deps.prisma.$transaction(
      async (tx) => {
        // ON CONFLICT DO NOTHING: un INSERT duplicado abortaría la transacción de PostgreSQL.
        const { count } = await tx.processedEvent.createMany({
          data: [{ eventId: id, consumer: deps.consumerName }],
          skipDuplicates: true,
        });
        if (count === 0) return 'duplicate' as const;
        await deps.handler(event, { tx, message });
        return 'processed' as const;
      },
      { timeout },
    );
  }

  return async (message) => {
    // 1. Contrato: un mensaje que no es un evento válido es veneno y nunca se arreglará reintentando.
    if (message.value === null) {
      return deadLetter(
        message,
        new Error('mensaje sin valor'),
        1,
        'poison',
        undefined,
        headerCorrelation(message),
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(message.value);
    } catch {
      return deadLetter(
        message,
        new Error('el valor no es JSON válido'),
        1,
        'poison',
        undefined,
        headerCorrelation(message),
      );
    }
    const decoded = codec.parse(json);
    if (!decoded.success) {
      return deadLetter(
        message,
        new Error(`${codec.noun} inválido: ${decoded.summary}`),
        1,
        'poison',
        undefined,
        headerCorrelation(message),
      );
    }
    const { value: event, id, type } = decoded.parsed;
    const correlationId = decoded.parsed.correlationId ?? headerCorrelation(message);
    if (deps.verify !== undefined && !(await deps.verify(message, event))) {
      return deadLetter(
        message,
        new Error(`verificación del ${codec.noun} fallida`),
        1,
        'poison',
        id,
        correlationId,
      );
    }

    // 2. Intentos: el primero más `maxRetries` reintentos, con backoff exponencial.
    let lastError: unknown;
    for (let n = 1; n <= policy.maxRetries + 1; n++) {
      try {
        const result = await attempt(event, id, message);
        if (result === 'duplicate') {
          logger.info(
            { consumer: deps.consumerName, eventId: id, correlationId },
            'evento duplicado ignorado',
          );
          return { kind: 'duplicate' };
        }
        logger.info(
          {
            consumer: deps.consumerName,
            eventId: id,
            correlationId,
            type,
            attempts: n,
          },
          'evento procesado',
        );
        return { kind: 'processed', attempts: n };
      } catch (error) {
        lastError = error;
        if (n <= policy.maxRetries) {
          logger.warn(
            {
              consumer: deps.consumerName,
              eventId: id,
              correlationId,
              attempt: n,
              err: error,
            },
            'fallo del handler; se reintenta',
          );
          await sleep(backoffDelay(n, policy, random));
        }
      }
    }
    return deadLetter(
      message,
      lastError,
      policy.maxRetries + 1,
      'retries-exhausted',
      id,
      correlationId,
    );
  };
}
