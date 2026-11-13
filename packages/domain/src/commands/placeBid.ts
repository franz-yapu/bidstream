import { z } from 'zod';
import { defineCommand } from './envelope.js';
import { money, uuid } from '../events/primitives.js';

/** Una puja solicitada. Todavía no es un hecho: el decisor la resuelve (ADR-0003, ADR-0011). */
export const placeBid = defineCommand(
  'PlaceBid',
  z.strictObject({
    lotId: uuid,
    bidderId: uuid,
    amount: money,
  }),
);
