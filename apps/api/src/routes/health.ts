import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const healthResponse = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number().int().nonnegative(),
});

/**
 * Liveness: el proceso responde. El health real (base de datos, Kafka y consumer lag, spec §7) se
 * amplía cuando existan los adaptadores de B2 y D2.
 */
export const healthRoutes: FastifyPluginAsyncZod = (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['sistema'],
        summary: 'Liveness del servicio',
        response: { 200: healthResponse },
      },
    },
    () => ({ status: 'ok' as const, uptimeSeconds: Math.floor(process.uptime()) }),
  );
  return Promise.resolve();
};
