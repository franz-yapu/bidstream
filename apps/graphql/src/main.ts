import { createPrismaClient } from '@bidstream/db';
import { loadConfig } from './config.js';
import { buildHttpServer } from './server.js';

const config = loadConfig(process.env);
const prisma = createPrismaClient(config.DATABASE_URL);
const server = buildHttpServer({ config, db: prisma });

function shutdown(signal: string): void {
  console.log(JSON.stringify({ level: 'info', msg: 'apagando', signal }));
  server.close(() => {
    void prisma.$disconnect().then(() => process.exit(0));
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
