import { createPrismaClient } from '@bidstream/db';
import { loadKafkaConfig } from '@bidstream/kafka';
import { createLogger, levelFromEnv } from '@bidstream/logging';
import { loadDeciderConfig } from './config.js';
import { createDecider } from './decider.js';

const config = loadDeciderConfig(process.env);
const kafka = loadKafkaConfig({ KAFKA_CLIENT_ID: 'bidstream-decider', ...process.env });
const logger = createLogger({ service: 'decider', level: levelFromEnv(process.env['LOG_LEVEL']) });

const prisma = createPrismaClient(config.DATABASE_URL);
const decider = await createDecider({
  kafka,
  prisma,
  logger,
  antiSniping: {
    windowMs: config.ANTI_SNIPING_WINDOW_MS,
    extensionMs: config.ANTI_SNIPING_EXTENSION_MS,
  },
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'apagando');
  await decider.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info(
  {
    antiSnipingWindowMs: config.ANTI_SNIPING_WINDOW_MS,
    antiSnipingExtensionMs: config.ANTI_SNIPING_EXTENSION_MS,
  },
  'decider iniciado',
);
await decider.run();
