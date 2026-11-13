import { createPrismaClient } from '@bidstream/db';
import { createLogger, levelFromEnv } from '@bidstream/logging';
import { loadKafkaConfig } from '@bidstream/kafka';
import { loadAuditorConfig } from './config.js';
import { createAuditor } from './auditor.js';

const config = loadAuditorConfig(process.env);
const kafka = loadKafkaConfig({ KAFKA_CLIENT_ID: 'bidstream-auditor', ...process.env });

const logger = createLogger({ service: 'auditor', level: levelFromEnv(process.env['LOG_LEVEL']) });

const prisma = createPrismaClient(config.DATABASE_URL);
const auditor = await createAuditor({
  kafka,
  prisma,
  logger,
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'apagando');
  await auditor.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info({}, 'auditor iniciado');
await auditor.run();
