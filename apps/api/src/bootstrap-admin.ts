import type { AuthService } from '@bidstream/auth';
import type { PrismaClient } from '@bidstream/db';
import type { Config } from './config.js';

interface Log {
  info(fields: Record<string, unknown>, message: string): void;
}

/**
 * Crea el primer ADMIN de un tenant al arrancar, si se configuró (`BOOTSTRAP_ADMIN_*`) y el tenant aún
 * no tiene ninguno. Es idempotente y nunca cambia la contraseña de un administrador existente.
 * Devuelve `true` si lo creó.
 */
export async function bootstrapAdmin(
  service: AuthService,
  db: Pick<PrismaClient, 'appUser'>,
  config: Pick<
    Config,
    'BOOTSTRAP_ADMIN_TENANT_ID' | 'BOOTSTRAP_ADMIN_EMAIL' | 'BOOTSTRAP_ADMIN_PASSWORD'
  >,
  log?: Log,
): Promise<boolean> {
  const { BOOTSTRAP_ADMIN_TENANT_ID: tenantId, BOOTSTRAP_ADMIN_EMAIL: email } = config;
  const password = config.BOOTSTRAP_ADMIN_PASSWORD;
  if (tenantId === undefined || email === undefined || password === undefined) return false;
  if ((await db.appUser.count({ where: { tenantId, role: 'ADMIN' } })) > 0) return false;
  await service.createUser({ tenantId, email, password, role: 'ADMIN' });
  log?.info({ tenantId }, 'administrador inicial creado');
  return true;
}
