import { z } from 'zod';
import { defineEvent } from './envelope.js';
import { isoDateTime, money, uuid } from './primitives.js';

export const BID_REJECTION_REASONS = [
  'BID_TOO_LOW',
  'LOT_CLOSED',
  'LOT_NOT_OPEN',
  'LOT_NOT_FOUND',
  'DUPLICATE_BID',
] as const;

export const bidPlaced = defineEvent(
  'BidPlaced',
  z.strictObject({
    lotId: uuid,
    bidderId: uuid,
    amount: money,
    placedAt: isoDateTime,
  }),
);

export const bidRejected = defineEvent(
  'BidRejected',
  z.strictObject({
    lotId: uuid,
    bidderId: uuid,
    amount: money,
    reason: z.enum(BID_REJECTION_REASONS),
  }),
);
