import type { EventType, PayloadOf } from './events/index.js';

/**
 * Evento sin sobre: lo que decide el dominio. El sobre (`eventId`, `occurredAt`, `tenantId`…)
 * lo añade la capa de aplicación con `buildEvent`.
 */
export type EventDraft = {
  [T in EventType]: { readonly type: T; readonly payload: PayloadOf<T> };
}[EventType];
