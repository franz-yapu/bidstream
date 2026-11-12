import { createPrismaClient } from '@bidstream/db';
import { createProducer, loadKafkaConfig } from '@bidstream/kafka';
import { loadRelayConfig } from './config.js';
import { OutboxRelay, type Logger } from './relay.js';

const config = loadRelayConfig(process.env);
const kafka = loadKafkaConfig({ KAFKA_CLIENT_ID: 'bidstream-relay', ...process.env });

const log =
  (level: string): Logger['info'] =>
  (fields, message) => {
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
const logger: Logger = { info: log('info'), warn: log('warn'), error: log('error') };

const prisma = createPrismaClient(config.DATABASE_URL);
const producer = await createProducer(kafka);
const relay = new OutboxRelay({
  prisma,
  databaseUrl: config.DATABASE_URL,
  batchSize: config.RELAY_BATCH_SIZE,
  pollIntervalMs: config.RELAY_POLL_MS,
  standbyPollMs: config.RELAY_STANDBY_POLL_MS,
  logger,
  publish: (request) =>
    producer.publish(request.topic, {
      key: request.key,
      value: request.value,
      headers: request.headers,
    }),
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'apagando');
  await relay.stop();
  await producer.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info({ batchSize: config.RELAY_BATCH_SIZE }, 'relay iniciado');
await relay.start();
