import { createPrismaClient } from '@bidstream/db';
import { loadKafkaConfig } from '@bidstream/kafka';
import { loadNotifierConfig } from './config.js';
import { createNotifier } from './notifier.js';

const config = loadNotifierConfig(process.env);
const kafka = loadKafkaConfig({ KAFKA_CLIENT_ID: 'bidstream-notifier', ...process.env });

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
const notifier = await createNotifier({
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
  await notifier.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info({}, 'notifier iniciado');
await notifier.run();
