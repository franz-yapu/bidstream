import { randomUUID } from 'node:crypto';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
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

  // --- Defensas de borde (OWASP A05), antes que la autenticación: un preflight CORS no lleva token ---
  void app.register(fastifyHelmet, {
    // CSP propia más abajo: la documentación (Swagger UI) necesita scripts y estilos en línea
    contentSecurityPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    strictTransportSecurity:
      config.NODE_ENV === 'production' ? { maxAge: 15_552_000, includeSubDomains: true } : false,
  });
  app.addHook('onSend', (request, reply, payload, done) => {
    // una API JSON no carga nada: ni recursos ni marcos; la documentación (/v1/docs) queda fuera
    if (!request.url.startsWith(`${API_PREFIX}/docs`)) {
      void reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    }
    // los tokens y las respuestas de autenticación no se guardan en cachés
    if (request.url.startsWith(`${API_PREFIX}/auth`))
      void reply.header('cache-control', 'no-store');
    done(null, payload);
  });
  if (config.CORS_ALLOWED_ORIGINS.length > 0) {
    void app.register(fastifyCors, {
      origin: config.CORS_ALLOWED_ORIGINS, // lista blanca exacta; nunca `*`
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-request-id'],
      exposedHeaders: [
        'x-request-id',
        'idempotency-replayed',
        'retry-after',
        'ratelimit-limit',
        'ratelimit-remaining',
        'ratelimit-reset',
      ],
      credentials: false,
      maxAge: 600,
    });
  }
  void app.register(fastifyRateLimit, {
    global: true,
    max: config.API_RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    // la salud no cuenta: la consultan los orquestadores con mucha frecuencia
    allowList: (request) => request.url === `${API_PREFIX}/health`,
    errorResponseBuilder: (_request, context) =>
      Object.assign(new Error('demasiadas peticiones'), { statusCode: context.statusCode }),
  });

  // Los ganchos de identidad y de acceso se añaden cuando ya están cargadas las defensas de borde,
  // para que corran después de ellas (cors responde al preflight antes de pedir un token).
  app.after(() => {
    if (deps.auth !== undefined) {
      registerAuthentication(app, deps.auth.verifier, () => deps.clock.now());
    }
    // Denegar por defecto (A01): solo en modo jwt toda ruta exige token y rol; en `header` (desarrollo) no.
    app.decorate(
      'routeDeclarations',
      registerAccessControl(app, { enforce: deps.config.AUTH_MODE === 'jwt' }),
    );
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
      bidRateLimitPerMinute: config.BID_RATE_LIMIT_PER_MINUTE,
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
