import { createPrismaClient } from '@bidstream/db';
import { createLogger, levelFromEnv } from '@bidstream/logging';
import { createProducer, loadKafkaConfig } from '@bidstream/kafka';
import { loadSigningKey } from '@bidstream/signing';
import { loadRelayConfig } from './config.js';
import { OutboxRelay } from './relay.js';

const config = loadRelayConfig(process.env);
const kafka = loadKafkaConfig({ KAFKA_CLIENT_ID: 'bidstream-relay', ...process.env });

const logger = createLogger({ service: 'relay', level: levelFromEnv(process.env['LOG_LEVEL']) });

const signer = loadSigningKey(process.env);
const prisma = createPrismaClient(config.DATABASE_URL);
const producer = await createProducer(kafka);
const relay = new OutboxRelay({
  prisma,
  databaseUrl: config.DATABASE_URL,
  signer,
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

logger.info(
  { batchSize: config.RELAY_BATCH_SIZE, signing: signer === null ? 'off' : signer.kid },
  'relay iniciado',
);
await relay.start();
