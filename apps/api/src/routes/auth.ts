import { InvalidAccessToken, PASSWORD_MAX_LENGTH, ROLES, type AuthService } from '@bidstream/auth';
import rateLimit from '@fastify/rate-limit';
import { primitives } from '@bidstream/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireIdentity } from '../auth-context.js';

const problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  requestId: z.string(),
  detail: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

const email = z.email().max(254);
const password = z.string().min(1).max(PASSWORD_MAX_LENGTH);
const refreshToken = z.string().min(20).max(200);

const tokenPair = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int(),
});

export interface AuthRoutesDeps {
  readonly service: AuthService;
  /** Peticiones por minuto y por IP (F1: red de seguridad contra fuerza bruta). */
  readonly rateLimitPerMinute: number;
}

/**
 * Autenticación (F1, ADR-0013). Los errores de credenciales son siempre el mismo `401` genérico: no
 * se revela si el usuario existe, si la contraseña falló o si la cuenta está bloqueada.
 */
export const authRoutes =
  (deps: AuthRoutesDeps): FastifyPluginAsyncZod =>
  async (app) => {
    await app.register(rateLimit, {
      max: deps.rateLimitPerMinute,
      timeWindow: '1 minute',
      errorResponseBuilder: (_request, context) => {
        // lo traduce el manejador central a problem+json
        const error = new Error('demasiadas peticiones') as Error & { statusCode: number };
        error.statusCode = context.statusCode;
        return error;
      },
    });
    const client = (request: { ip: string; headers: { 'user-agent'?: string | undefined } }) => ({
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    app.post(
      '/register',
      {
        config: { public: true },
        schema: {
          tags: ['autenticación'],
          summary: 'Registra un postor (rol BIDDER)',
          body: z.strictObject({ tenantId: primitives.uuid, email, password }),
          response: {
            201: z.object({ userId: z.uuid(), email: z.string(), role: z.literal('BIDDER') }),
            400: problem,
            409: problem,
            429: problem,
          },
        },
      },
      async (request, reply) => {
        const user = await deps.service.createUser({ ...request.body, role: 'BIDDER' });
        return reply
          .code(201)
          .send({ userId: user.id, email: user.email, role: 'BIDDER' as const });
      },
    );

    app.post(
      '/login',
      {
        config: { public: true },
        schema: {
          tags: ['autenticación'],
          summary: 'Inicia sesión',
          body: z.strictObject({ tenantId: primitives.uuid, email, password }),
          response: { 200: tokenPair, 400: problem, 401: problem, 429: problem },
        },
      },
      async (request) => deps.service.login(request.body, client(request)),
    );

    app.post(
      '/refresh',
      {
        config: { public: true },
        schema: {
          tags: ['autenticación'],
          summary: 'Cambia un refresh token por un par nuevo (rotación)',
          body: z.strictObject({ refreshToken }),
          response: { 200: tokenPair, 400: problem, 401: problem, 429: problem },
        },
      },
      async (request) => deps.service.refresh(request.body.refreshToken, client(request)),
    );

    app.post(
      '/logout',
      {
        config: { public: true },
        schema: {
          tags: ['autenticación'],
          summary: 'Cierra la sesión (revoca la familia del refresh token)',
          body: z.strictObject({ refreshToken }),
          response: { 204: z.null(), 400: problem, 429: problem },
        },
      },
      async (request, reply) => {
        await deps.service.logout(request.body.refreshToken);
        return reply.code(204).send(null);
      },
    );

    app.get(
      '/me',
      {
        config: { roles: ['ADMIN', 'SELLER', 'BIDDER'] },
        schema: {
          tags: ['autenticación'],
          summary: 'Usuario autenticado',
          response: {
            200: z.object({
              userId: z.uuid(),
              tenantId: z.uuid(),
              role: z.enum(['ADMIN', 'SELLER', 'BIDDER']),
              email: z.string(),
            }),
            401: problem,
            403: problem,
          },
        },
      },
      async (request) => {
        const identity = requireIdentity(request);
        const profile = await deps.service.profile(identity);
        // el usuario del token ya no existe, está deshabilitado o es de otro tenant
        if (profile === null) throw new InvalidAccessToken();
        return { ...identity, email: profile.email };
      },
    );

    app.post(
      '/users',
      {
        config: { roles: ['ADMIN'] },
        schema: {
          tags: ['autenticación'],
          summary: 'Crea un usuario en el tenant del administrador (ADMIN, SELLER o BIDDER)',
          body: z.strictObject({ email, password, role: z.enum(ROLES) }),
          response: {
            201: z.object({ userId: z.uuid(), email: z.string(), role: z.enum(ROLES) }),
            400: problem,
            401: problem,
            403: problem,
            409: problem,
          },
        },
      },
      async (request, reply) => {
        const admin = requireIdentity(request);
        const user = await deps.service.createUser({ ...request.body, tenantId: admin.tenantId });
        return reply.code(201).send({ userId: user.id, email: user.email, role: user.role });
      },
    );

    return Promise.resolve();
  };
