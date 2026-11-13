import { primitives } from '@bidstream/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { placeBid, type CommandDeps } from '../commands/index.js';
import type { BidderResolver } from '../bidder.js';
import type { TenantResolver } from '../tenant.js';

const problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  requestId: z.string(),
  detail: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

const identityHeaders = z.object({
  'x-tenant-id': z
    .string()
    .optional()
    .describe('Tenant (UUID). Provisional hasta F1: solo fuera de producción.'),
  'x-bidder-id': z
    .string()
    .optional()
    .describe('Postor (UUID). Provisional hasta F1: solo fuera de producción.'),
  'idempotency-key': z
    .string()
    .regex(/^[A-Za-z0-9._-]{16,128}$/, 'debe tener 16–128 caracteres [A-Za-z0-9._-]')
    .describe(
      'Obligatoria. La misma clave con la misma petición devuelve el mismo commandId (cabecera `Idempotency-Replayed: true`); con otra petición, 422.',
    ),
});

export interface BidRoutesDeps extends CommandDeps {
  readonly tenantResolver: TenantResolver;
  readonly bidderResolver: BidderResolver;
}

/**
 * Puja: el **202** significa «aceptada, no resuelta» (ADR-0003). El resultado (`BidPlaced` o
 * `BidRejected`) llega por evento y se consulta o se sigue por GraphQL.
 */
export const bidRoutes =
  (deps: BidRoutesDeps): FastifyPluginAsyncZod =>
  (app) => {
    app.post(
      '/lots/:id/bids',
      {
        config: { roles: ['BIDDER'] },
        schema: {
          tags: ['comandos'],
          summary: 'Solicita una puja',
          description:
            'Acepta el comando y lo publica; un consumidor decisor lo resuelve en orden por lote. Una puja baja o tardía no es un error HTTP: produce un evento `BidRejected`.',
          headers: identityHeaders,
          params: z.object({ id: primitives.uuid }),
          body: z.strictObject({ amount: primitives.money }),
          response: {
            202: z.object({ commandId: z.uuid(), status: z.literal('ACCEPTED') }),
            400: problem,
            401: problem,
            403: problem,
            404: problem,
            422: problem,
          },
        },
      },
      async (request, reply) => {
        const tenantId = deps.tenantResolver.resolve(request);
        const bidderId = deps.bidderResolver.resolve(request);
        const { commandId, replayed } = await placeBid(
          deps,
          tenantId,
          bidderId,
          request.params.id,
          { amount: request.body.amount, idempotencyKey: request.headers['idempotency-key'] },
          { correlationId: request.id },
        );
        if (replayed) void reply.header('idempotency-replayed', 'true');
        return reply.code(202).send({ commandId, status: 'ACCEPTED' as const });
      },
    );

    return Promise.resolve();
  };
