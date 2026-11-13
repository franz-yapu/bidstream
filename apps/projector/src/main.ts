import { createPrismaClient } from '@bidstream/db';
import { createLogger, levelFromEnv } from '@bidstream/logging';
import { verifierFromEnv } from '@bidstream/signing';
import type { DomainEvent } from '@bidstream/domain';
import { loadKafkaConfig } from '@bidstream/kafka';
import { loadProjectorConfig } from './config.js';
import { createProjector } from './projector.js';

const config = loadProjectorConfig(process.env);
const kafka = loadKafkaConfig({ KAFKA_CLIENT_ID: 'bidstream-projector', ...process.env });

const logger = createLogger({
  service: 'projector',
  level: levelFromEnv(process.env['LOG_LEVEL']),
});

// F3: con la firma activada, un evento sin firma válida va al DLQ como veneno
const verify = verifierFromEnv<DomainEvent>(process.env, (event) => event.occurredAt);
const prisma = createPrismaClient(config.DATABASE_URL);
const projector = await createProjector({
  kafka,
  prisma,
  logger,
  ...(verify === undefined ? {} : { verify }),
  groupId: config.PROJECTOR_GROUP_ID,
  topics: [config.PROJECTOR_TOPIC],
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
