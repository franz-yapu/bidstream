import { randomUUID } from 'node:crypto';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUI from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { Clock, IdGenerator } from '@bidstream/domain';
import type { PrismaClient } from '@bidstream/db';
import type { Config } from './config.js';
import { registerErrorHandlers } from './errors.js';
import type { AuthService, TokenVerifier } from '@bidstream/auth';
import type { DlqAdminPort } from './admin-dlq.js';
import { registerAccessControl, type RouteDeclaration } from './access-control.js';
import { registerAuthentication } from './auth-context.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { auctionRoutes } from './routes/auctions.js';
import { bidRoutes } from './routes/bids.js';
import { HeaderBidderResolver, type BidderResolver } from './bidder.js';
import { healthRoutes } from './routes/health.js';
import type { TenantResolver } from './tenant.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Rutas registradas y su política de acceso (para comprobar que ninguna quedó sin declarar). */
    routeDeclarations: RouteDeclaration[];
  }
}

export const API_PREFIX = '/v1';

/** Dependencias de la API. Los adaptadores (B2: base de datos, D2: Kafka) se inyectan aquí. */
export interface AppDeps {
  readonly config: Config;
  readonly prisma: Pick<PrismaClient, '$transaction'>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly tenantResolver: TenantResolver;
  /** Por defecto `X-Bidder-Id` (provisional hasta F1). */
  readonly bidderResolver?: BidderResolver;
  /** Topic de comandos de puja. */
  readonly commandsTopic: string;
  /** Topic de destino de los eventos (`bidstream.events.lot`). */
  readonly eventsTopic: string;
  /** Administración del DLQ (D7); si falta, esas rutas no existen. */
  readonly adminDlq?: { readonly port: DlqAdminPort };
  /** Autenticación propia (F1): rutas `/v1/auth/*` y verificación del token de acceso. */
  readonly auth?: { readonly service: AuthService; readonly verifier: TokenVerifier };
  /** Destino de los logs; solo las pruebas lo cambian para capturarlos. */
  readonly logStream?: { write(chunk: string): void };
}

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Construye la aplicación sin escuchar (las pruebas usan `app.inject()`). Las rutas de negocio de
 * C2/C3 se añaden como plugins bajo `/v1`.
 */
export function buildApp(deps: AppDeps): FastifyInstance {
  const { config } = deps;
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      ...(deps.logStream === undefined ? {} : { stream: deps.logStream }),
    },
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

  if (deps.auth !== undefined) {
    registerAuthentication(app, deps.auth.verifier, () => deps.clock.now());
  }
  // Denegar por defecto (A01): solo en modo jwt toda ruta exige token y rol; en `header` (desarrollo) no.
  app.decorate(
    'routeDeclarations',
    registerAccessControl(app, { enforce: deps.config.AUTH_MODE === 'jwt' }),
  );
  if (deps.auth !== undefined) {
    void app.register(
      authRoutes({
        service: deps.auth.service,
        rateLimitPerMinute: deps.config.AUTH_RATE_LIMIT_PER_MINUTE,
      }),
      { prefix: `${API_PREFIX}/auth` },
    );
  }
  void app.register(healthRoutes, { prefix: API_PREFIX });
  void app.register(
    auctionRoutes({
      prisma: deps.prisma,
      clock: deps.clock,
      ids: deps.ids,
      eventsTopic: deps.eventsTopic,
      commandsTopic: deps.commandsTopic,
      tenantResolver: deps.tenantResolver,
    }),
    { prefix: API_PREFIX },
  );
  void app.register(
    bidRoutes({
      prisma: deps.prisma,
      clock: deps.clock,
      ids: deps.ids,
      eventsTopic: deps.eventsTopic,
      commandsTopic: deps.commandsTopic,
      tenantResolver: deps.tenantResolver,
      bidderResolver: deps.bidderResolver ?? new HeaderBidderResolver(),
    }),
    { prefix: API_PREFIX },
  );
  if (deps.adminDlq !== undefined && deps.auth !== undefined) {
    void app.register(adminRoutes(deps.adminDlq), { prefix: `${API_PREFIX}/admin` });
  }
  return app;
}
