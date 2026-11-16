import {
  bearerToken,
  InvalidAccessToken,
  verifyAccessToken,
  type TokenVerifier,
} from '@bidstream/auth';
import { primitives } from '@bidstream/domain';
import { badInput, unauthenticated } from './errors.js';

type Headers = { get(name: string): string | null };

/**
 * Tenant por cabecera. Solo para desarrollo y pruebas: `X-Tenant-Id` lo elige el cliente, así que la
 * configuración impide usarlo en producción (OWASP A01).
 */
export function resolveTenant(headers: Headers): string {
  const header = headers.get('x-tenant-id');
  if (header === null || header === '')
    throw unauthenticated('Se requiere la cabecera X-Tenant-Id.');
  if (!primitives.uuid.safeParse(header).success) throw badInput('X-Tenant-Id debe ser un UUID.');
  return header;
}

/**
 * Tenant del token de acceso (F1): `Authorization: Bearer <jwt>`. Cualquier rol puede leer, pero solo
 * lo de su tenant. Un token ausente, mal formado, caducado o de firma no válida es `UNAUTHENTICATED`.
 */
export async function resolveTenantFromToken(
  headers: Headers,
  verifier: TokenVerifier,
  now: Date = new Date(),
): Promise<string> {
  const token = bearerToken(headers.get('authorization') ?? undefined);
  if (token === undefined)
    throw unauthenticated('Se requiere un token de acceso (Authorization: Bearer).');
  try {
    return (await verifyAccessToken(token, verifier, now)).tenantId;
  } catch (error) {
    if (error instanceof InvalidAccessToken) throw unauthenticated('Token inválido o caducado.');
    throw error;
  }
}

/**
 * Tenant de un visitante anónimo (J2): el configurado en `PUBLIC_TENANT_ID`, solo si la petición **no
 * trae ninguna credencial**. Si trae una (aunque sea inválida) no se degrada a anónimo: así un token
 * caducado se nota en lugar de verse como un visitante.
 */
export function anonymousTenant(
  headers: Headers,
  publicTenantId: string | undefined,
): string | null {
  if (publicTenantId === undefined) return null;
  const hasCredentials =
    (headers.get('authorization') ?? '') !== '' || (headers.get('x-tenant-id') ?? '') !== '';
  return hasCredentials ? null : publicTenantId;
}
