import { z } from 'zod';
import { defineEvent } from './envelope.js';
import { currency, isoDateTime, money, title, uuid } from './primitives.js';

export const lotPublished = defineEvent(
  'LotPublished',
  z.strictObject({
    lotId: uuid,
    auctionId: uuid,
    title,
    startingPrice: money,
    minIncrement: money,
    currency,
    closesAt: isoDateTime,
  }),
);

export const lotExtended = defineEvent(
  'LotExtended',
  z.strictObject({
    lotId: uuid,
    newClosesAt: isoDateTime,
    reason: z.literal('anti-sniping'),
  }),
);

/** Un lote sin pujas se cierra sin adjudicar: `winnerId` y `finalAmount` son ambos `null`. */
export const lotClosed = defineEvent(
  'LotClosed',
  z
    .strictObject({
      lotId: uuid,
      winnerId: uuid.nullable(),
      finalAmount: money.nullable(),
    })
    .refine((p) => (p.winnerId === null) === (p.finalAmount === null), {
      message: 'winnerId y finalAmount deben ser ambos null o ambos con valor',
      path: ['winnerId'],
    }),
);
