import { primitives } from '@bidstream/domain';
import { GraphQLError } from 'graphql';
import type { GraphQLContext } from '../context.js';
import { findLot } from '../data.js';
import { badInput } from '../errors.js';
import { lotUpdates, type LotUpdatePayload } from './iterator.js';

const TYPE_NAMES: Readonly<Record<LotUpdatePayload['type'], string>> = {
  LotPublished: 'LotPublishedUpdate',
  BidPlaced: 'BidPlacedUpdate',
  LotExtended: 'LotExtendedUpdate',
  LotClosed: 'LotClosedUpdate',
  ResyncRequired: 'ResyncRequired',
};

/** Resolutores de `Subscription.lotUpdated` y de la unión `LotUpdate`. */
export const subscriptionResolvers = {
  Subscription: {
    lotUpdated: {
      subscribe: async (_: unknown, args: { lotId: string }, ctx: GraphQLContext) => {
        if (!primitives.uuid.safeParse(args.lotId).success) {
          throw badInput('el identificador debe ser un UUID');
        }
        // Un lote que no existe (o es de otro tenant) no admite suscripciones: evita crear suscripciones
        // a identificadores arbitrarios y no revela lotes ajenos.
        const lot = await findLot(ctx, args.lotId);
        if (lot === null) {
          throw new GraphQLError('El lote no existe.', {
            extensions: { code: 'NOT_FOUND', http: { status: 404 } },
          });
        }
        const release = ctx.subscriptions.acquire(ctx.tenantId, ctx.maxSubscriptionsPerTenant);
        return lotUpdates({
          bus: ctx.bus,
          tenantId: ctx.tenantId,
          lotId: args.lotId,
          maxQueue: ctx.subscriptionQueue,
          onClose: release,
        });
      },
      resolve: (payload: LotUpdatePayload) => payload,
    },
  },
  LotUpdate: {
    __resolveType: (payload: LotUpdatePayload): string => TYPE_NAMES[payload.type],
  },
  LotUpdateBase: {
    __resolveType: (payload: LotUpdatePayload): string => TYPE_NAMES[payload.type],
  },
};
