import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { auctionClosed, auctionOpened } from './auction.js';
import { bidPlaced, bidRejected } from './bid.js';
import { lotClosed, lotExtended, lotPublished } from './lot.js';
import type { metaSchema } from './envelope.js';
import { EVENT_VERSION } from './envelope.js';

export { BID_REJECTION_REASONS } from './bid.js';
export { EVENT_VERSION } from './envelope.js';

/** Unión discriminada por `type`: el contrato de los 7 eventos de dominio (spec §3). */
export const domainEventSchema = z.discriminatedUnion('type', [
  auctionOpened,
  lotPublished,
  bidPlaced,
  bidRejected,
  lotExtended,
  lotClosed,
  auctionClosed,
]);

export type DomainEvent = z.infer<typeof domainEventSchema>;
export type EventType = DomainEvent['type'];
export type EventOf<T extends EventType> = Extract<DomainEvent, { type: T }>;
export type PayloadOf<T extends EventType> = EventOf<T>['payload'];
export type EventMeta = z.infer<typeof metaSchema>;

export type ParseResult =
  | { readonly success: true; readonly event: DomainEvent }
  | { readonly success: false; readonly error: z.ZodError };

/** Valida un mensaje entrante (p. ej. un valor de Kafka ya deserializado). */
export function parseEvent(input: unknown): ParseResult {
  const result = domainEventSchema.safeParse(input);
  return result.success
    ? { success: true, event: result.data }
    : { success: false, error: result.error };
}

export interface BuildDeps {
  readonly newId: () => string;
  readonly now: () => Date;
}

const defaultDeps: BuildDeps = { newId: () => uuidv7(), now: () => new Date() };

/**
 * Fabrica un evento válido. El id y el reloj se inyectan para que el dominio sea determinista
 * en las pruebas; lanza si el resultado no cumple el contrato.
 */
export function buildEvent<T extends EventType>(
  type: T,
  tenantId: string,
  payload: PayloadOf<T>,
  options: { readonly deps?: BuildDeps; readonly meta?: EventMeta } = {},
): EventOf<T> {
  const deps = options.deps ?? defaultDeps;
  const candidate = {
    eventId: deps.newId(),
    type,
    occurredAt: deps.now().toISOString(),
    tenantId,
    version: EVENT_VERSION,
    payload,
    ...(options.meta === undefined ? {} : { meta: options.meta }),
  };
  return domainEventSchema.parse(candidate) as EventOf<T>;
}

/**
 * Clave de partición del mensaje en Kafka (ADR-0001): `lotId` para los eventos de lote, de modo
 * que todo lo de un lote se procesa en orden. Los eventos de subasta no tienen `lotId`; usan
 * `auctionId` (DEC-006).
 */
export function partitionKey(event: DomainEvent): string {
  switch (event.type) {
    case 'AuctionOpened':
    case 'AuctionClosed':
      return event.payload.auctionId;
    case 'LotPublished':
    case 'BidPlaced':
    case 'BidRejected':
    case 'LotExtended':
    case 'LotClosed':
      return event.payload.lotId;
  }
}
