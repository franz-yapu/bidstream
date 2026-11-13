import type { Role } from '@bidstream/auth';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireIdentity } from './auth-context.js';
import { ProblemError } from './problem.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Ruta sin autenticación (salud, documentación, registro e inicio de sesión). */
    public?: boolean;
    /** Roles que pueden usar la ruta. Una ruta sin `public` ni `roles` se deniega (A01). */
    roles?: readonly Role[];
  }
}

export interface RouteDeclaration {
  readonly method: string | readonly string[];
  readonly url: string;
  readonly public: boolean;
  readonly roles: readonly Role[];
}

/** Rutas públicas que no declaran `config.public` porque las registra un plugin (Swagger UI). */
const PUBLIC_PREFIXES = ['/v1/docs'];

const forbidden = (detail: string): ProblemError =>
  new ProblemError(403, 'urn:bidstream:problem:forbidden', 'Acceso denegado', detail);

/** Exige una identidad con uno de los roles; 401 si no hay token, 403 si el rol no basta. */
export function requireRole(request: FastifyRequest, roles: readonly Role[]): void {
  const identity = requireIdentity(request);
  if (!roles.includes(identity.role)) {
    throw forbidden('Su rol no permite esta operación.');
  }
}

/**
 * Control de acceso **denegar por defecto** (OWASP A01). Con `enforce` (modo `jwt`), toda ruta exige un
 * token válido salvo las declaradas `public`, y solo la pueden usar los roles de `config.roles`; una ruta
 * que no declare ni lo uno ni lo otro se deniega. Devuelve el listado de rutas declaradas para poder
 * comprobar en pruebas que ninguna se quedó sin política.
 */
export function registerAccessControl(
  app: FastifyInstance,
  options: { readonly enforce: boolean },
): RouteDeclaration[] {
  const declared: RouteDeclaration[] = [];
  app.addHook('onRoute', (route) => {
    declared.push({
      method: route.method,
      url: route.url,
      public: route.config?.public === true || PUBLIC_PREFIXES.some((p) => route.url.startsWith(p)),
      roles: route.config?.roles ?? [],
    });
  });
  if (!options.enforce) return declared;

  app.addHook('onRequest', (request, _reply, done) => {
    try {
      const config = request.routeOptions.config;
      const path = request.url.split('?')[0] ?? '';
      if (config.public === true || PUBLIC_PREFIXES.some((p) => path.startsWith(p))) {
        done();
        return;
      }
      const identity = requireIdentity(request); // 401 sin token válido (también en rutas inexistentes)
      if (config.roles === undefined || config.roles.length === 0) {
        throw forbidden('Esta ruta no declara qué roles pueden usarla.');
      }
      if (!config.roles.includes(identity.role)) {
        throw forbidden('Su rol no permite esta operación.');
      }
      done();
    } catch (error) {
      done(error as Error);
    }
  });
  return declared;
}
