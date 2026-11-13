import { createPrismaClient } from '@bidstream/db';
import { createLogger, levelFromEnv } from '@bidstream/logging';
import { InMemoryNotificationBus, startNotificationListener } from '@bidstream/notifier';
import { loadConfig } from './config.js';
import { buildHttpServer } from './server.js';

const config = loadConfig(process.env);
const prisma = createPrismaClient(config.DATABASE_URL);
const logger = createLogger({ service: 'graphql', level: levelFromEnv(process.env['LOG_LEVEL']) });

// Las subscriptions se alimentan del canal LISTEN/NOTIFY de PostgreSQL (D5): cada réplica escucha el
// canal con una conexión dedicada y reparte en su propio bus.
const bus = new InMemoryNotificationBus((error) => {
  logger.warn({ err: error }, 'un suscriptor falló');
});
const listener = startNotificationListener({
  connectionString: config.DATABASE_URL,
  bus,
  logger,
});

const server = buildHttpServer({ config, db: prisma, bus });

function shutdown(signal: string): void {
  logger.info({ signal }, 'apagando');
  server.close(() => {
    void listener
      .stop()
      .then(() => prisma.$disconnect())
      .then(() => process.exit(0));
  });
  server.closeAllConnections();
}
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});

server.listen(config.GRAPHQL_PORT, config.HOST, () => {
  logger.info({ port: config.GRAPHQL_PORT }, 'graphql iniciado');
});
