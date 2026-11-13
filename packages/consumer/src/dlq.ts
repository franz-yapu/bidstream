import { primitives } from '@bidstream/domain';
import { maskUrlPasswords } from '@bidstream/logging';
import type { IncomingMessage } from '@bidstream/kafka';
import { z } from 'zod';

export const DLQ_REASONS = ['poison', 'retries-exhausted'] as const;
export type DlqReason = (typeof DLQ_REASONS)[number];

/** Mensaje del dead-letter topic. Lo lee el endpoint de reproceso (D7). Nunca lleva traza. */
export const dlqMessageSchema = z.strictObject({
  /** Valor original sin tocar: se puede republicar tal cual. */
  original: z.string().nullable(),
  key: z.string().nullable(),
  error: z.strictObject({ name: z.string(), message: z.string() }),
  consumer: z.string().min(1),
  attempts: z.number().int().min(1),
  reason: z.enum(DLQ_REASONS),
  source: z.strictObject({
    topic: z.string(),
    partition: z.number().int().min(0),
    offset: z.string(),
  }),
  failedAt: primitives.isoDateTime,
  /**
   * Cuántas veces se reprocesó ya este evento (cabecera `x-reprocess-count` del mensaje que falló).
   * Opcional para que los mensajes anteriores sigan siendo válidos; sirve de guardia contra bucles.
   */
  reprocessCount: z.number().int().min(0).optional(),
  /** Id de correlación de la petición que originó el evento (F4); opcional por compatibilidad. */
  correlationId: z.string().min(1).max(128).optional(),
});
export type DlqMessage = z.infer<typeof dlqMessageSchema>;

const MAX_ERROR_MESSAGE = 1_000;

export function describeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: maskUrlPasswords(error.message).slice(0, MAX_ERROR_MESSAGE),
    };
  }
  return { name: 'Error', message: maskUrlPasswords(String(error)).slice(0, MAX_ERROR_MESSAGE) };
}

/** Reprocesos previos del mensaje, leídos de su cabecera; cualquier valor inválido cuenta como 0. */
export function reprocessCountOf(message: IncomingMessage): number {
  const raw = Number(message.headers['x-reprocess-count']);
  return Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

export function buildDlqMessage(input: {
  readonly message: IncomingMessage;
  readonly consumer: string;
  readonly error: unknown;
  readonly attempts: number;
  readonly reason: DlqReason;
  readonly now: Date;
  readonly correlationId?: string | undefined;
}): DlqMessage {
  const { message } = input;
  return {
    original: message.value,
    key: message.key,
    error: describeError(input.error),
    consumer: input.consumer,
    attempts: input.attempts,
    reason: input.reason,
    source: { topic: message.topic, partition: message.partition, offset: message.offset },
    failedAt: input.now.toISOString(),
    reprocessCount: reprocessCountOf(message),
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
  };
}
