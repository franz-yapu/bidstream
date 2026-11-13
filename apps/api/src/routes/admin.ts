import { primitives } from '@bidstream/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { DlqAdminPort } from '../admin-dlq.js';
import { requireRole } from '../access-control.js';

const problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  requestId: z.string(),
  detail: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

const entrySchema = z.object({
  eventId: z.string().nullable(),
  type: z.string().nullable(),
  consumer: z.string(),
  reason: z.enum(['poison', 'retries-exhausted']),
  attempts: z.number().int(),
  reprocessCount: z.number().int(),
  error: z.object({ name: z.string(), message: z.string() }),
  source: z.object({ topic: z.string(), partition: z.number().int(), offset: z.string() }),
  key: z.string().nullable(),
  failedAt: z.string(),
  original: z.string().nullable().optional(),
});

const summarySchema = z.object({
  mode: z.enum(['pending', 'selective']),
  examined: z.number().int(),
  republished: z.number().int(),
  republishedEventIds: z.array(z.string()),
  skipped: z.object({
    poison: z.number().int(),
    tooManyAttempts: z.number().int(),
    notSelected: z.number().int(),
    invalid: z.number().int(),
  }),
  notFound: z.array(z.string()),
  remaining: z.number().int(),
});

export interface AdminRoutesDeps {
  readonly port: DlqAdminPort;
}

/**
 * Administración del DLQ. Solo para el rol `ADMIN` (F1): el DLQ mezcla eventos de todos los tenants, así
 * que la ejerce quien administra la plataforma. Estas rutas solo se registran si hay autenticación.
 */
export const adminRoutes =
  (deps: AdminRoutesDeps): FastifyPluginAsyncZod =>
  (app) => {
    // Siempre ADMIN, también fuera del modo jwt: nunca hay administración sin un token de administrador.
    app.addHook('onRequest', (request, _reply, done) => {
      try {
        requireRole(request, ['ADMIN']);
        done();
      } catch (error) {
        done(error as Error);
      }
    });

    app.get(
      '/dlq',
      {
        config: { roles: ['ADMIN'] },
        schema: {
          tags: ['administración'],
          summary: 'Lista el contenido del DLQ sin consumirlo',
          querystring: z.object({
            limit: z.coerce.number().int().min(1).max(1_000).optional(),
            includeOriginal: z.enum(['true', 'false']).optional(),
          }),
          response: {
            200: z.object({
              entries: z.array(entrySchema),
              pending: z.number().int(),
              total: z.number().int(),
            }),
            401: problem,
            403: problem,
          },
        },
      },
      async (request) => {
        const result = await deps.port.peek({
          ...(request.query.limit === undefined ? {} : { limit: request.query.limit }),
          includeOriginal: request.query.includeOriginal === 'true',
        });
        // Se copian las listas: los tipos del consumidor son de solo lectura y los de Zod, mutables.
        return { entries: [...result.entries], pending: result.pending, total: result.total };
      },
    );

    app.post(
      '/dlq/reprocess',
      {
        config: { roles: ['ADMIN'] },
        schema: {
          tags: ['administración'],
          summary: 'Republica los eventos fallidos del DLQ en su topic original',
          description:
            'Modo pendientes (por defecto) o selectivo por `eventIds`. El evento llega al final de su partición: ' +
            'sirve para fallos transitorios; para reconstruir la proyección en orden use el reproceso desde el log.',
          body: z
            .strictObject({
              limit: z.number().int().min(1).max(1_000).optional(),
              eventIds: z.array(primitives.uuid).min(1).max(100).optional(),
            })
            .refine((b) => b.limit === undefined || b.eventIds === undefined, {
              message: 'limit y eventIds son excluyentes: el modo selectivo no usa límite',
              path: ['limit'],
            }),
          response: {
            200: summarySchema,
            400: problem,
            401: problem,
            403: problem,
            409: problem,
          },
        },
      },
      async (request) => {
        const summary = await deps.port.reprocess({
          ...(request.body.limit === undefined ? {} : { limit: request.body.limit }),
          ...(request.body.eventIds === undefined ? {} : { eventIds: request.body.eventIds }),
        });
        // Trazabilidad de una operación de administración (OWASP A09): quién la pidió (`actor`, el
        // administrador del token), qué se hizo y con qué resultado. Nunca el contenido de los eventos.
        request.log.info(
          {
            requestId: request.id,
            actor: request.identity?.userId,
            mode: summary.mode,
            examined: summary.examined,
            republished: summary.republished,
            eventIds: summary.republishedEventIds,
          },
          'reproceso del DLQ',
        );
        return {
          ...summary,
          republishedEventIds: [...summary.republishedEventIds],
          notFound: [...summary.notFound],
        };
      },
    );

    return Promise.resolve();
  };
