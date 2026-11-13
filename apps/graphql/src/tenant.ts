import { primitives } from '@bidstream/domain';
import { badInput, unauthenticated } from './errors.js';

/**
 * Tenant de la petición. Provisional hasta F1: lee `X-Tenant-Id`, que cualquier cliente puede
 * elegir, y por eso la configuración impide usarlo en producción (OWASP A01).
 */
export function resolveTenant(headers: { get(name: string): string | null }): string {
  const header = headers.get('x-tenant-id');
  if (header === null || header === '')
    throw unauthenticated('Se requiere la cabecera X-Tenant-Id.');
  if (!primitives.uuid.safeParse(header).success) throw badInput('X-Tenant-Id debe ser un UUID.');
  return header;
}
