import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { STATUS_CODES } from 'node:http';
import {
  AuctionClosed,
  AuctionNotFound,
  IdempotencyKeyReused,
  InvalidCommand,
  LotNotFound,
} from './commands/index.js';
import { ProblemError } from './problem.js';

/** Cuerpo de error RFC 9457 (`application/problem+json`). Nunca incluye trazas ni detalles internos. */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly requestId: string;
  readonly detail?: string;
  readonly errors?: readonly { readonly path: string; readonly message: string }[];
}

const PROBLEM_TYPES: Readonly<Record<number, { type: string; title: string }>> = {
  400: { type: 'urn:bidstream:problem:bad-request', title: 'Solicitud inválida' },
  401: { type: 'urn:bidstream:problem:unauthorized', title: 'No autenticado' },
  404: { type: 'urn:bidstream:problem:not-found', title: 'Recurso no encontrado' },
  409: { type: 'urn:bidstream:problem:conflict', title: 'Conflicto con el estado actual' },
  413: { type: 'urn:bidstream:problem:payload-too-large', title: 'Cuerpo demasiado grande' },
  415: {
    type: 'urn:bidstream:problem:unsupported-media-type',
    title: 'Tipo de contenido no soportado',
  },
  422: { type: 'urn:bidstream:problem:business-rule', title: 'Regla de negocio incumplida' },
  500: { type: 'urn:bidstream:problem:internal-error', title: 'Error interno' },
};

function sendProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  extra: Pick<ProblemDetails, 'detail' | 'errors'> & {
    type?: string;
    title?: string;
    headers?: Readonly<Record<string, string>>;
  } = {},
): FastifyReply {
  const known = PROBLEM_TYPES[status];
  const body: ProblemDetails = {
    type: extra.type ?? known?.type ?? 'about:blank',
    title: extra.title ?? known?.title ?? STATUS_CODES[status] ?? 'Error',
    status,
    requestId: request.id,
    ...(extra.detail === undefined ? {} : { detail: extra.detail }),
    ...(extra.errors === undefined ? {} : { errors: extra.errors }),
  };
  for (const [name, value] of Object.entries(extra.headers ?? {})) void reply.header(name, value);
  return reply.code(status).type('application/problem+json').send(body);
}

function toPath(instancePath: string): string {
  return instancePath.replace(/^\//, '').replaceAll('/', '.');
}

/** Manejo central de errores y de 404: un solo formato para validación, rutas y fallos. */
export function registerErrorHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    sendProblem(request, reply, 404, {
      detail: `${request.method} ${request.url.split('?')[0] ?? ''} no existe`,
    }),
  );

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ProblemError) {
      return sendProblem(request, reply, error.status, {
        type: error.type,
        title: error.title,
        headers: error.headers,
        ...(error.detail === undefined ? {} : { detail: error.detail }),
      });
    }
    if (error instanceof InvalidCommand) {
      return sendProblem(request, reply, 422, { detail: error.message });
    }
    if (error instanceof AuctionNotFound) {
      // La proyección es eventualmente consistente: una subasta recién creada puede no estar aún.
      return sendProblem(request, reply, 404, {
        detail: 'La subasta no existe. Si acaba de crearse, reintente en un instante.',
        headers: { 'retry-after': '1' },
      });
    }
    if (error instanceof IdempotencyKeyReused) {
      return sendProblem(request, reply, 422, {
        type: 'urn:bidstream:problem:idempotency-key-reused',
        title: 'Idempotency-Key reutilizada',
        detail:
          'La clave ya se usó con otra petición (distinto lote o monto). Use una clave nueva.',
      });
    }
    if (error instanceof LotNotFound) {
      // La proyección es eventualmente consistente: un lote recién publicado puede no estar aún.
      return sendProblem(request, reply, 404, {
        detail: 'El lote no existe. Si acaba de publicarse, reintente en un instante.',
        headers: { 'retry-after': '1' },
      });
    }
    if (error instanceof AuctionClosed) {
      return sendProblem(request, reply, 409, { detail: 'La subasta está cerrada.' });
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return sendProblem(request, reply, 400, {
        type: 'urn:bidstream:problem:validation-error',
        title: 'Solicitud inválida',
        errors: error.validation.map((issue) => ({
          path: toPath(issue.instancePath),
          message: issue.message ?? 'valor inválido',
        })),
      });
    }

    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, 'la respuesta no cumple su esquema');
      return sendProblem(request, reply, 500);
    }

    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      // Errores del cliente generados por Fastify (JSON mal formado, cuerpo grande, tipo no soportado).
      return sendProblem(request, reply, status, {
        detail: STATUS_CODES[status] ?? 'Error del cliente',
      });
    }

    // 5xx: el detalle va solo al log; al cliente no se le revela nada interno (OWASP A05).
    request.log.error({ err: error }, 'error no controlado');
    return sendProblem(request, reply, 500);
  });
}
