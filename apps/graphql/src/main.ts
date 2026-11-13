import { createPrismaClient } from '@bidstream/db';
import { InMemoryNotificationBus, startNotificationListener } from '@bidstream/notifier';
import { loadConfig } from './config.js';
import { buildHttpServer } from './server.js';

const config = loadConfig(process.env);
const prisma = createPrismaClient(config.DATABASE_URL);

// Las subscriptions se alimentan del canal LISTEN/NOTIFY de PostgreSQL (D5): cada réplica escucha el
// canal con una conexión dedicada y reparte en su propio bus.
const bus = new InMemoryNotificationBus((error) => {
  console.log(JSON.stringify({ level: 'warn', msg: 'un suscriptor falló', error: String(error) }));
});
const log =
  (level: string) =>
  (fields: Record<string, unknown>, message: string): void => {
    console.log(JSON.stringify({ level, time: new Date().toISOString(), msg: message, ...fields }));
  };
const listener = startNotificationListener({
  connectionString: config.DATABASE_URL,
  bus,
  logger: { info: log('info'), warn: log('warn') },
});

const server = buildHttpServer({ config, db: prisma, bus });

function shutdown(signal: string): void {
  console.log(JSON.stringify({ level: 'info', msg: 'apagando', signal }));
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
  console.log(
    JSON.stringify({ level: 'info', msg: 'graphql iniciado', port: config.GRAPHQL_PORT }),
  );
});
