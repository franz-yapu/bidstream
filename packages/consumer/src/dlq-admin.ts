import { parseEvent } from '@bidstream/domain';
import {
  createConsumer,
  createKafkaAdmin,
  createProducer,
  TOPICS,
  type IncomingMessage,
  type KafkaConfig,
} from '@bidstream/kafka';
import { randomUUID } from 'node:crypto';
import { dlqMessageSchema, type DlqMessage } from './dlq.js';

/** Máximo de reprocesos por evento: guardia contra el bucle de un fallo permanente. */
export const MAX_REPROCESS = 3;
/** Grupo que recuerda, con su offset, qué parte del DLQ ya se reprocesó. */
export const REPROCESSOR_GROUP = 'dlq-reprocessor';

/** Otro reproceso está en marcha: el grupo `dlq-reprocessor` tiene miembros. */
export class DlqBusyError extends Error {
  constructor() {
    super('ya hay un reproceso del DLQ en marcha');
    this.name = 'DlqBusyError';
  }
}

export interface DlqAdminOptions {
  readonly kafka: KafkaConfig;
  /** Por defecto `bidstream.events.lot.dlq`. */
  readonly dlqTopic?: string;
  /** Tiempo máximo de lectura del DLQ (ms). Por defecto 30 000. */
  readonly timeoutMs?: number;
  /** Grupo que recuerda lo ya reprocesado; por defecto `dlq-reprocessor`. Solo las pruebas lo cambian. */
  readonly reprocessorGroup?: string;
}

export interface DlqEntry {
  readonly eventId: string | null;
  readonly type: string | null;
  readonly consumer: string;
  readonly reason: DlqMessage['reason'];
  readonly attempts: number;
  readonly reprocessCount: number;
  readonly error: DlqMessage['error'];
  readonly source: DlqMessage['source'];
  readonly key: string | null;
  readonly failedAt: string;
  /** Valor original del evento; solo si se pide expresamente. */
  readonly original?: string | null;
}

export interface PeekResult {
  readonly entries: readonly DlqEntry[];
  /** Mensajes del DLQ que el grupo de reproceso aún no ha confirmado. */
  readonly pending: number;
  readonly total: number;
}

export interface ReprocessSummary {
  readonly mode: 'pending' | 'selective';
  readonly examined: number;
  readonly republished: number;
  readonly republishedEventIds: readonly string[];
  readonly skipped: {
    readonly poison: number;
    readonly tooManyAttempts: number;
    readonly notSelected: number;
    readonly invalid: number;
  };
  /** Solo en modo selectivo: los `eventIds` pedidos que no están en el DLQ. */
  readonly notFound: readonly string[];
  /** Pendientes del grupo de reproceso tras esta llamada. */
  readonly remaining: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

interface Decoded {
  readonly dlq: DlqMessage | null;
  readonly eventId: string | null;
  readonly type: string | null;
}

/** Interpreta un mensaje del DLQ; si el contenido original es un evento válido, extrae su identidad. */
function decode(message: IncomingMessage): Decoded {
  let json: unknown;
  try {
    json = JSON.parse(message.value ?? 'null');
  } catch {
    return { dlq: null, eventId: null, type: null };
  }
  const parsed = dlqMessageSchema.safeParse(json);
  if (!parsed.success) return { dlq: null, eventId: null, type: null };
  const dlq = parsed.data;
  if (dlq.original === null) return { dlq, eventId: null, type: null };
  try {
    const event = parseEvent(JSON.parse(dlq.original));
    return event.success
      ? { dlq, eventId: event.event.eventId, type: event.event.type }
      : { dlq, eventId: null, type: null };
  } catch {
    return { dlq, eventId: null, type: null };
  }
}

/**
 * Lee exactamente `count` mensajes del DLQ con el grupo indicado y llama a `handle` para cada uno.
 * Un mensaje solo se confirma si `handle` resuelve; los que lleguen de más se rechazan para que no
 * se confirmen sin haberse tratado.
 */
async function drain(
  options: DlqAdminOptions,
  groupId: string,
  count: number,
  handle: (message: IncomingMessage) => Promise<void>,
): Promise<number> {
  if (count <= 0) return 0;
  const topic = options.dlqTopic ?? TOPICS.eventsLotDlq;
  let handled = 0;
  let committed = 0;
  const consumer = await createConsumer(options.kafka, {
    groupId,
    topics: [topic],
    fromBeginning: true,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timeout leyendo el DLQ (${String(handled)} de ${String(count)})`));
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      // Se espera al commit del último mensaje: desconectar con un commit en vuelo tumba el cliente nativo.
      void consumer
        .run(
          async (message) => {
            if (handled >= count) throw new Error('límite alcanzado: no se trata ni se confirma');
            await handle(message);
            handled += 1;
          },
          {
            onCommitted: () => {
              committed += 1;
              if (committed >= count) {
                clearTimeout(timer);
                resolve();
              }
            },
          },
        )
        .catch(reject);
    });
  } finally {
    await consumer.disconnect();
  }
  return handled;
}

const toEntry = (decoded: Decoded, includeOriginal: boolean): DlqEntry | null => {
  const { dlq } = decoded;
  if (dlq === null) return null;
  return {
    eventId: decoded.eventId,
    type: decoded.type,
    consumer: dlq.consumer,
    reason: dlq.reason,
    attempts: dlq.attempts,
    reprocessCount: dlq.reprocessCount ?? 0,
    error: dlq.error,
    source: dlq.source,
    key: dlq.key,
    failedAt: dlq.failedAt,
    ...(includeOriginal ? { original: dlq.original } : {}),
  };
};

/**
 * Lista lo que hay en el DLQ **sin consumirlo**: usa un grupo efímero (que se borra al terminar) y no
 * toca el offset del grupo de reproceso.
 */
export async function peekDlq(
  options: DlqAdminOptions & { limit?: number; includeOriginal?: boolean },
): Promise<PeekResult> {
  const topic = options.dlqTopic ?? TOPICS.eventsLotDlq;
  const admin = await createKafkaAdmin(options.kafka);
  const ephemeral = `dlq-peek-${randomUUID()}`;
  try {
    const total = (await admin.consumerLag(ephemeral, topic)).total;
    const pending = (await admin.consumerLag(options.reprocessorGroup ?? REPROCESSOR_GROUP, topic))
      .total;
    const entries: DlqEntry[] = [];
    const limit = Math.min(options.limit ?? 50, 1_000);
    // Se lee todo (el DLQ es pequeño) y se muestran los `limit` más recientes.
    await drain(options, ephemeral, total, (message) => {
      const entry = toEntry(decode(message), options.includeOriginal === true);
      if (entry !== null) entries.push(entry);
      return Promise.resolve();
    });
    await admin.deleteGroup(ephemeral).catch(() => undefined);
    return { entries: entries.slice(-limit), pending, total };
  } finally {
    await admin.disconnect();
  }
}

export interface ReprocessOptions extends DlqAdminOptions {
  /** Modo pendientes: máximo de mensajes a tratar (1–1 000, por defecto 100). */
  readonly limit?: number;
  /** Modo selectivo: solo estos eventos, sin tocar lo pendiente. */
  readonly eventIds?: readonly string[];
}

/**
 * Republica en el topic original los eventos que fallaron, con su clave y valor intactos, para que
 * el consumidor que los rechazó los procese (los demás grupos los ignoran como duplicados).
 *
 * **Limitación de orden:** el evento llega al final de su partición, después de los posteriores del
 * mismo lote. Sirve para fallos transitorios; para la integridad de la proyección, el reproceso
 * completo desde el log (G2). Solo se republica `retries-exhausted` con un contenido válido y menos
 * de `MAX_REPROCESS` reprocesos previos; los «veneno» no se arreglan reintentando.
 */
export async function reprocessDlq(options: ReprocessOptions): Promise<ReprocessSummary> {
  const topic = options.dlqTopic ?? TOPICS.eventsLotDlq;
  const selective = options.eventIds !== undefined;
  const wanted = new Set(options.eventIds ?? []);
  const admin = await createKafkaAdmin(options.kafka);
  const producer = await createProducer(options.kafka);
  const skipped = { poison: 0, tooManyAttempts: 0, notSelected: 0, invalid: 0 };
  const republishedEventIds: string[] = [];
  const seenWanted = new Set<string>();
  let examined = 0;

  const handle = async (message: IncomingMessage): Promise<void> => {
    examined += 1;
    const decoded = decode(message);
    const { dlq, eventId } = decoded;
    if (dlq === null) {
      skipped.invalid += 1;
      return;
    }
    if (selective) {
      if (eventId !== null && wanted.has(eventId)) seenWanted.add(eventId);
      else {
        skipped.notSelected += 1;
        return;
      }
    }
    if (dlq.reason !== 'retries-exhausted' || dlq.original === null || eventId === null) {
      skipped.poison += 1;
      return;
    }
    const previous = dlq.reprocessCount ?? 0;
    if (previous >= MAX_REPROCESS) {
      skipped.tooManyAttempts += 1;
      return;
    }
    await producer.publish(dlq.source.topic, {
      key: dlq.key ?? '',
      value: dlq.original,
      headers: {
        eventId,
        type: decoded.type ?? '',
        version: '1',
        'x-reprocess-count': String(previous + 1),
        'x-dlq-source': `${dlq.source.topic}:${String(dlq.source.partition)}:${dlq.source.offset}`,
      },
    });
    republishedEventIds.push(eventId);
  };

  try {
    if (selective) {
      const ephemeral = `dlq-selective-${randomUUID()}`;
      const total = (await admin.consumerLag(ephemeral, topic)).total;
      await drain(options, ephemeral, total, handle);
      await admin.deleteGroup(ephemeral).catch(() => undefined);
    } else {
      const reprocessor = options.reprocessorGroup ?? REPROCESSOR_GROUP;
      const group = await admin.describeGroup(reprocessor);
      if (group !== null && group.members > 0) throw new DlqBusyError();
      const pending = (await admin.consumerLag(reprocessor, topic)).total;
      const limit = Math.min(Math.max(options.limit ?? 100, 1), 1_000);
      await drain(options, reprocessor, Math.min(limit, pending), handle);
    }
    const remaining = (
      await admin.consumerLag(options.reprocessorGroup ?? REPROCESSOR_GROUP, topic)
    ).total;
    return {
      mode: selective ? 'selective' : 'pending',
      examined,
      republished: republishedEventIds.length,
      republishedEventIds,
      skipped,
      notFound: selective ? [...wanted].filter((id) => !seenWanted.has(id)) : [],
      remaining,
    };
  } finally {
    await producer.disconnect();
    await admin.disconnect();
  }
}
