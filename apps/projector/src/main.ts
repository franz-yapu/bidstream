import { createPrismaClient } from '@bidstream/db';
import { createLogger, levelFromEnv } from '@bidstream/logging';
import { loadKafkaConfig } from '@bidstream/kafka';
import { loadProjectorConfig } from './config.js';
import { createProjector } from './projector.js';

const config = loadProjectorConfig(process.env);
const kafka = loadKafkaConfig({ KAFKA_CLIENT_ID: 'bidstream-projector', ...process.env });

const logger = createLogger({
  service: 'projector',
  level: levelFromEnv(process.env['LOG_LEVEL']),
});

const prisma = createPrismaClient(config.DATABASE_URL);
const projector = await createProjector({
  kafka,
  prisma,
  logger,
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'apagando');
  await projector.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info({}, 'projector iniciado');
await projector.run();
