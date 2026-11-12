import { createPrismaClient } from '@bidstream/db';
import { TOPICS } from '@bidstream/kafka/topics';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { SystemClock, Uuid7Generator } from './system.js';
import { HeaderTenantResolver } from './tenant.js';

const config = loadConfig(process.env);
const prisma = createPrismaClient(config.DATABASE_URL);
const app = buildApp({
  config,
  prisma,
  clock: new SystemClock(),
  ids: new Uuid7Generator(),
  tenantResolver: new HeaderTenantResolver(),
  eventsTopic: TOPICS.eventsLot,
});
app.addHook('onClose', async () => {
  await prisma.$disconnect();
});

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
