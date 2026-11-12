import { primitives } from '@bidstream/domain';
import type { FastifyRequest } from 'fastify';
import { ProblemError } from './problem.js';

/** Obtiene el tenant de la petición. F1 lo sustituirá por el claim del JWT. */
export interface TenantResolver {
  resolve(request: FastifyRequest): string;
}

/**
 * Solución provisional: lee `X-Tenant-Id`. Cualquier cliente puede elegir su tenant, así que la
 * configuración impide usarla en producción (OWASP A01).
 */
export class HeaderTenantResolver implements TenantResolver {
  resolve(request: FastifyRequest): string {
    const header = request.headers['x-tenant-id'];
    if (typeof header !== 'string' || header === '') {
      throw new ProblemError(
        401,
        'urn:bidstream:problem:unauthorized',
        'Falta el tenant',
        'Se requiere la cabecera X-Tenant-Id.',
      );
    }
    if (!primitives.uuid.safeParse(header).success) {
      throw new ProblemError(
        400,
        'urn:bidstream:problem:bad-request',
        'Tenant inválido',
        'X-Tenant-Id debe ser un UUID.',
      );
    }
    return header;
  }
}
