import { z } from 'zod';
import { defineEvent } from './envelope.js';
import { isoDateTime, title, uuid } from './primitives.js';

export const auctionOpened = defineEvent(
  'AuctionOpened',
  z
    .strictObject({
      auctionId: uuid,
      title,
      opensAt: isoDateTime,
      closesAt: isoDateTime,
    })
    .refine((p) => Date.parse(p.opensAt) < Date.parse(p.closesAt), {
      message: 'closesAt debe ser posterior a opensAt',
      path: ['closesAt'],
    }),
);

export const auctionClosed = defineEvent('AuctionClosed', z.strictObject({ auctionId: uuid }));
