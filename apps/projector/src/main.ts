import { createPrismaClient } from '@bidstream/db';
import { loadKafkaConfig } from '@bidstream/kafka';
import { loadProjectorConfig } from './config.js';
import { createProjector } from './projector.js';

const config = loadProjectorConfig(process.env);
const kafka = loadKafkaConfig({ KAFKA_CLIENT_ID: 'bidstream-projector', ...process.env });

type Fields = Record<string, unknown>;
const log =
  (level: string) =>
  (fields: Fields, message: string): void => {
    const { err, ...rest } = fields;
    console.log(
      JSON.stringify({
        level,
        time: new Date().toISOString(),
        msg: message,
        ...rest,
        ...(err === undefined
          ? {}
          : { error: err instanceof Error ? err.message : JSON.stringify(err) }),
      }),
    );
  };
const logger = { info: log('info'), warn: log('warn'), error: log('error') };

const prisma = createPrismaClient(config.DATABASE_URL);
const projector = await createProjector({
  kafka,
  prisma,
  logger,
  onOutcome: (outcome, message) => {
    logger.info(
      {
        outcome: outcome.kind,
        topic: message.topic,
        partition: message.partition,
        offset: message.offset,
      },
      'evento procesado',
    );
  },
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
