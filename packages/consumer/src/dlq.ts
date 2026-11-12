import { primitives } from '@bidstream/domain';
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
});
export type DlqMessage = z.infer<typeof dlqMessageSchema>;

const MAX_ERROR_MESSAGE = 1_000;

export function describeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message.slice(0, MAX_ERROR_MESSAGE) };
  }
  return { name: 'Error', message: String(error).slice(0, MAX_ERROR_MESSAGE) };
}

export function buildDlqMessage(input: {
  readonly message: IncomingMessage;
  readonly consumer: string;
  readonly error: unknown;
  readonly attempts: number;
  readonly reason: DlqReason;
  readonly now: Date;
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
  };
}
