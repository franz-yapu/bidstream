import { AuthService, loadAuthConfig } from '@bidstream/auth';
import { createPrismaClient } from '@bidstream/db';
import { TOPICS } from '@bidstream/kafka/topics';
import { lazyDlqAdmin } from './admin-dlq.js';
import { buildApp } from './app.js';
import { JwtBidderResolver, JwtTenantResolver } from './auth-context.js';
import { HeaderBidderResolver } from './bidder.js';
import { bootstrapAdmin } from './bootstrap-admin.js';
import { loadConfig } from './config.js';
import { SystemClock, Uuid7Generator } from './system.js';
import { HeaderTenantResolver } from './tenant.js';

const config = loadConfig(process.env);
const prisma = createPrismaClient(config.DATABASE_URL);

// F1: en modo jwt la identidad sale del token; las claves son obligatorias. En modo header (solo fuera
// de producción) la autenticación existe igualmente si hay claves, para poder probarla en local.
const authConfig =
  config.AUTH_MODE === 'jwt' || process.env['AUTH_JWT_PRIVATE_KEY'] !== undefined
    ? loadAuthConfig(process.env)
    : undefined;
const authService =
  authConfig === undefined ? undefined : new AuthService({ db: prisma, config: authConfig });

const app = buildApp({
  config,
  prisma,
  clock: new SystemClock(),
  ids: new Uuid7Generator(),
  tenantResolver: config.AUTH_MODE === 'jwt' ? new JwtTenantResolver() : new HeaderTenantResolver(),
  bidderResolver: config.AUTH_MODE === 'jwt' ? new JwtBidderResolver() : new HeaderBidderResolver(),
  eventsTopic: TOPICS.eventsLot,
  commandsTopic: TOPICS.commandsBid,
  ...(authConfig === undefined || authService === undefined
    ? {}
    : { auth: { service: authService, verifier: authConfig.verifier } }),
  // la administración del DLQ (rol ADMIN) solo existe si hay autenticación
  ...(authService === undefined ? {} : { adminDlq: { port: lazyDlqAdmin({ env: process.env }) } }),
});
app.addHook('onClose', async () => {
  await prisma.$disconnect();
});

if (authService !== undefined) await bootstrapAdmin(authService, prisma, config, app.log);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'apagando');
  await app.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
