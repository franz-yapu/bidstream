import { createPrismaClient } from '@bidstream/db';
import { TOPICS } from '@bidstream/kafka';
import { createLogger, levelFromEnv } from '@bidstream/logging';
import { Closer } from './closer.js';
import { loadCloserConfig } from './config.js';

const config = loadCloserConfig(process.env);
const logger = createLogger({ service: 'closer', level: levelFromEnv(process.env['LOG_LEVEL']) });

const prisma = createPrismaClient(config.DATABASE_URL);
const closer = new Closer({
  prisma,
  databaseUrl: config.DATABASE_URL,
  commandsTopic: TOPICS.commandsBid,
  eventsTopic: TOPICS.eventsLot,
  pollIntervalMs: config.CLOSER_POLL_MS,
  batchSize: config.CLOSER_BATCH_SIZE,
  idempotencyRetentionMs: config.IDEMPOTENCY_RETENTION_MS,
  logger,
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'apagando');
  await closer.stop();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info({ pollMs: config.CLOSER_POLL_MS }, 'closer iniciado');
await closer.start();
