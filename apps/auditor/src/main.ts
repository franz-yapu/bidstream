import { createPrismaClient } from '@bidstream/db';
import { loadKafkaConfig } from '@bidstream/kafka';
import { loadAuditorConfig } from './config.js';
import { createAuditor } from './auditor.js';

const config = loadAuditorConfig(process.env);
const kafka = loadKafkaConfig({ KAFKA_CLIENT_ID: 'bidstream-auditor', ...process.env });

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
const auditor = await createAuditor({
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
  await auditor.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info({}, 'auditor iniciado');
await auditor.run();
