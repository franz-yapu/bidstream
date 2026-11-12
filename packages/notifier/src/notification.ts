import { primitives, type DomainEvent } from '@bidstream/domain';
import { z } from 'zod';

const common = {
  eventId: primitives.uuidV7,
  occurredAt: primitives.isoDateTime,
  tenantId: primitives.uuid,
  lotId: primitives.uuid,
};

/**
 * Notificación pública de un lote (docs/sdd/D5/SDD.md §2.2). Se deriva **solo del evento** y no
 * incluye la identidad del postor ni del ganador: una subasta pública no debe revelar quién puja en
 * tiempo real, y sin autenticación (F1) no hay forma de decidir quién puede verlo.
 */
export const lotNotificationSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('LotPublished'),
    ...common,
    auctionId: primitives.uuid,
    startingPrice: primitives.money,
    closesAt: primitives.isoDateTime,
  }),
  z.strictObject({
    type: z.literal('BidPlaced'),
    ...common,
    /** Nuevo precio vigente del lote. */
    amount: primitives.money,
    placedAt: primitives.isoDateTime,
  }),
  z.strictObject({
    type: z.literal('LotExtended'),
    ...common,
    newClosesAt: primitives.isoDateTime,
  }),
  z.strictObject({
    type: z.literal('LotClosed'),
    ...common,
    /** `null` si el lote se cerró desierto. */
    finalAmount: primitives.money.nullable(),
    hasWinner: z.boolean(),
  }),
]);

export type LotNotification = z.infer<typeof lotNotificationSchema>;

/**
 * Notificación de lote que corresponde a un evento, o `null` si el evento no genera ninguna:
 * `AuctionOpened` y `AuctionClosed` no son de un lote, y `BidRejected` es privado del postor.
 */
export function toLotNotification(event: DomainEvent): LotNotification | null {
  const base = { eventId: event.eventId, occurredAt: event.occurredAt, tenantId: event.tenantId };
  switch (event.type) {
    case 'LotPublished':
      return {
        type: 'LotPublished',
        ...base,
        lotId: event.payload.lotId,
        auctionId: event.payload.auctionId,
        startingPrice: event.payload.startingPrice,
        closesAt: event.payload.closesAt,
      };
    case 'BidPlaced':
      return {
        type: 'BidPlaced',
        ...base,
        lotId: event.payload.lotId,
        amount: event.payload.amount,
        placedAt: event.payload.placedAt,
      };
    case 'LotExtended':
      return {
        type: 'LotExtended',
        ...base,
        lotId: event.payload.lotId,
        newClosesAt: event.payload.newClosesAt,
      };
    case 'LotClosed':
      return {
        type: 'LotClosed',
        ...base,
        lotId: event.payload.lotId,
        finalAmount: event.payload.finalAmount,
        hasWinner: event.payload.winnerId !== null,
      };
    case 'AuctionOpened':
    case 'AuctionClosed':
    case 'BidRejected':
      return null;
  }
}
