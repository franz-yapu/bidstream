/** Nombres de topics (spec §4). La auto-creación está desactivada: un typo debe fallar. */
export const TOPICS = {
  commandsBid: 'bidstream.commands.bid',
  eventsLot: 'bidstream.events.lot',
  eventsLotDlq: 'bidstream.events.lot.dlq',
} as const;

/** Grupos de consumidores independientes sobre el mismo topic (spec §4). */
export const CONSUMER_GROUPS = {
  projector: 'projector',
  notifier: 'notifier',
  auditor: 'auditor',
} as const;
