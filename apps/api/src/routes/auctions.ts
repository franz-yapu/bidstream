import { primitives } from '@bidstream/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { openAuction, publishLot, type CommandDeps } from '../commands/index.js';
import type { TenantResolver } from '../tenant.js';

/** Cuerpo de error `problem+json` (documentación OpenAPI de las respuestas 4xx). */
const problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  requestId: z.string(),
  detail: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

const tenantHeader = z.object({
  'x-tenant-id': z
    .string()
    .optional()
    .describe('Tenant (UUID). Provisional hasta F1: solo fuera de producción.'),
});

const openAuctionBody = z
  .strictObject({
    title: primitives.title,
    opensAt: primitives.isoDateTime,
    closesAt: primitives.isoDateTime,
  })
  .refine((b) => Date.parse(b.opensAt) < Date.parse(b.closesAt), {
    message: 'closesAt debe ser posterior a opensAt',
    path: ['closesAt'],
  });

const publishLotBody = z.strictObject({
  title: primitives.title,
  startingPrice: primitives.money,
  minIncrement: primitives.money,
  currency: primitives.currency,
  closesAt: primitives.isoDateTime,
});

export interface AuctionRoutesDeps extends CommandDeps {
  readonly tenantResolver: TenantResolver;
}

/**
 * Comandos de subastas y lotes. El 201 significa «comando aceptado»: el evento queda en el outbox y
 * el estado visible llega cuando el `projector` lo procesa.
 */
export const auctionRoutes =
  (deps: AuctionRoutesDeps): FastifyPluginAsyncZod =>
  (app) => {
    app.post(
      '/auctions',
      {
        schema: {
          tags: ['comandos'],
          summary: 'Abre una subasta',
          headers: tenantHeader,
          body: openAuctionBody,
          response: {
            201: z.object({ auctionId: z.uuid(), status: z.literal('OPEN') }),
            400: problem,
            401: problem,
            422: problem,
          },
        },
      },
      async (request, reply) => {
        const tenantId = deps.tenantResolver.resolve(request);
        const { auctionId } = await openAuction(deps, tenantId, request.body);
        return reply
          .code(201)
          .header('location', `/v1/auctions/${auctionId}`)
          .send({ auctionId, status: 'OPEN' as const });
      },
    );

    app.post(
      '/auctions/:id/lots',
      {
        schema: {
          tags: ['comandos'],
          summary: 'Publica un lote en una subasta abierta',
          headers: tenantHeader,
          params: z.object({ id: primitives.uuid }),
          body: publishLotBody,
          response: {
            201: z.object({ lotId: z.uuid(), auctionId: z.uuid(), status: z.literal('OPEN') }),
            400: problem,
            401: problem,
            404: problem,
            409: problem,
            422: problem,
          },
        },
      },
      async (request, reply) => {
        const tenantId = deps.tenantResolver.resolve(request);
        const { lotId, auctionId } = await publishLot(
          deps,
          tenantId,
          request.params.id,
          request.body,
        );
        return reply
          .code(201)
          .header('location', `/v1/auctions/${auctionId}/lots/${lotId}`)
          .send({ lotId, auctionId, status: 'OPEN' as const });
      },
    );

    return Promise.resolve();
  };
