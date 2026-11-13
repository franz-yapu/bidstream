import {
  bearerToken,
  InvalidAccessToken,
  verifyAccessToken,
  type Identity,
  type TokenVerifier,
} from '@bidstream/auth';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { BidderResolver } from './bidder.js';
import { ProblemError } from './problem.js';
import type { TenantResolver } from './tenant.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Quien hace la petición, si presentó un token de acceso válido (F1). */
    identity?: Identity;
  }
}

/**
 * Autentica la petición: si trae `Authorization: Bearer`, el token debe ser válido (si no, 401 al
 * instante) y la identidad queda en `request.identity`. Sin cabecera no hace nada: quien necesite
 * identidad (los resolvedores y, en F1-RBAC, el control de acceso) la exigirá.
 */
export function registerAuthentication(
  app: FastifyInstance,
  verifier: TokenVerifier,
  now: () => Date = () => new Date(),
): void {
  app.addHook('onRequest', async (request) => {
    const header = request.headers.authorization;
    if (header === undefined) return;
    const token = bearerToken(header);
    if (token === undefined) throw new InvalidAccessToken();
    request.identity = await verifyAccessToken(token, verifier, now());
  });
}

/** Identidad ya autenticada, o 401. */
export function requireIdentity(request: FastifyRequest): Identity {
  if (request.identity === undefined) {
    throw new ProblemError(
      401,
      'urn:bidstream:problem:unauthorized',
      'No autenticado',
      'Se requiere un token de acceso (Authorization: Bearer).',
      { 'www-authenticate': 'Bearer' },
    );
  }
  return request.identity;
}

/** El tenant sale del token (F1), nunca de una cabecera que el cliente pueda elegir. */
export class JwtTenantResolver implements TenantResolver {
  resolve(request: FastifyRequest): string {
    return requireIdentity(request).tenantId;
  }
}

/** El postor es el usuario autenticado. */
export class JwtBidderResolver implements BidderResolver {
  resolve(request: FastifyRequest): string {
    return requireIdentity(request).userId;
  }
}
