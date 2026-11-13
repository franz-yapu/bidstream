import { primitives } from '@bidstream/domain';
import type { FastifyRequest } from 'fastify';
import { ProblemError } from './problem.js';

/** Obtiene el postor de la petición. F1 lo sustituirá por el `sub` del JWT. */
export interface BidderResolver {
  resolve(request: FastifyRequest): string;
}

/**
 * Solución provisional (como `HeaderTenantResolver`, ADR-0010): lee `X-Bidder-Id`. Cualquier cliente
 * podría pujar como otro, así que la configuración impide usarla en producción (OWASP A01).
 */
export class HeaderBidderResolver implements BidderResolver {
  resolve(request: FastifyRequest): string {
    const header = request.headers['x-bidder-id'];
    if (typeof header !== 'string' || header === '') {
      throw new ProblemError(
        401,
        'urn:bidstream:problem:unauthorized',
        'Falta el postor',
        'Se requiere la cabecera X-Bidder-Id.',
      );
    }
    if (!primitives.uuid.safeParse(header).success) {
      throw new ProblemError(
        400,
        'urn:bidstream:problem:bad-request',
        'Postor inválido',
        'X-Bidder-Id debe ser un UUID.',
      );
    }
    return header;
  }
}
