import { createPrismaClient } from '@bidstream/db';
import { createLogger, levelFromEnv } from '@bidstream/logging';
import { loadKafkaConfig } from '@bidstream/kafka';
import { loadNotifierConfig } from './config.js';
import { createNotifier } from './notifier.js';

const config = loadNotifierConfig(process.env);
const kafka = loadKafkaConfig({ KAFKA_CLIENT_ID: 'bidstream-notifier', ...process.env });

const logger = createLogger({ service: 'notifier', level: levelFromEnv(process.env['LOG_LEVEL']) });

const prisma = createPrismaClient(config.DATABASE_URL);
const notifier = await createNotifier({
  kafka,
  prisma,
  logger,
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'apagando');
  await notifier.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info({}, 'notifier iniciado');
await notifier.run();
