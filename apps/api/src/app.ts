import { randomUUID } from 'node:crypto';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUI from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { Config } from './config.js';
import { registerErrorHandlers } from './errors.js';
import { healthRoutes } from './routes/health.js';

export const API_PREFIX = '/v1';

/** Dependencias de la API. Los adaptadores (B2: base de datos, D2: Kafka) se inyectan aquí. */
export interface AppDeps {
  readonly config: Config;
}

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Construye la aplicación sin escuchar (las pruebas usan `app.inject()`). Las rutas de negocio de
 * C2/C3 se añaden como plugins bajo `/v1`.
 */
export function buildApp({ config }: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    // Se acepta el id del cliente solo si es inofensivo (evita inyección en logs).
    requestIdHeader: false,
    genReqId: (req) => {
      const header = req.headers['x-request-id'];
      return typeof header === 'string' && REQUEST_ID.test(header) ? header : randomUUID();
    },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandlers(app);

  app.addHook('onSend', (request, reply, payload, done) => {
    void reply.header('x-request-id', request.id);
    done(null, payload);
  });

  void app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'bidstream API de comandos',
        description:
          'Motor de subastas orientado a eventos. Los comandos se aceptan; el resultado llega por evento.',
        version: '0.1.0',
      },
    },
    transform: jsonSchemaTransform,
  });
  void app.register(fastifySwaggerUI, { routePrefix: `${API_PREFIX}/docs` });

  void app.register(healthRoutes, { prefix: API_PREFIX });
  return app;
}
