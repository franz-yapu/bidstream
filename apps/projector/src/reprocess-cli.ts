import { createPrismaClient } from '@bidstream/db';
import type { DomainEvent } from '@bidstream/domain';
import { createKafkaAdmin, loadKafkaConfig } from '@bidstream/kafka';
import { verifierFromEnv } from '@bidstream/signing';
import { loadProjectorConfig } from './config.js';
import { createProjector } from './projector.js';
import { GroupActiveError, reprocessProjection, waitForLagZero } from './reprocess.js';

/**
 * `npm run reprocess -w @bidstream/projector -- --yes`
 *
 * Borra la proyección, reposiciona el grupo `projector` a `earliest` y la reconstruye desde el log,
 * mostrando el progreso. Es la demostración del reproceso (spec §5).
 */
const args = new Set(process.argv.slice(2));
const say = (message: string): void => {
  console.log(message);
};

if (!args.has('--yes')) {
  say('Esto BORRA la proyección (bid, lot, auction) y la reconstruye desde el log de Kafka.');
  say('Detenga el projector y vuelva a ejecutar con --yes para confirmar.');
  process.exit(2);
}

const config = loadProjectorConfig(process.env);
const kafka = loadKafkaConfig({ KAFKA_CLIENT_ID: 'bidstream-reprocess', ...process.env });
const prisma = createPrismaClient(config.DATABASE_URL);
const verify = verifierFromEnv<DomainEvent>(process.env, (event) => event.occurredAt);
const topic = config.PROJECTOR_TOPIC;
const groupId = config.PROJECTOR_GROUP_ID;

try {
  say('1/3 Comprobando que el projector está parado…');
  say('2/3 Borrando la proyección y reposicionando el grupo a earliest…');
  const { eventsInLog } = await reprocessProjection({
    prisma,
    kafka,
    yes: true,
    topic,
    groupId,
  });
  say(`    proyección vacía; ${String(eventsInLog)} eventos por reaplicar desde el log`);

  say('3/3 Reconstruyendo desde el log…');
  const started = Date.now();
  let applied = 0;
  const projector = await createProjector({
    kafka,
    prisma,
    groupId,
    topics: [topic],
    ...(verify === undefined ? {} : { verify }),
    onOutcome: () => {
      applied += 1;
      if (applied % 100 === 0) say(`    ${String(applied)} / ${String(eventsInLog)}`);
    },
  });
  void projector.run();
  const admin = await createKafkaAdmin(kafka);
  try {
    await waitForLagZero(admin, groupId, topic, { timeoutMs: 10 * 60_000 });
  } finally {
    await admin.disconnect();
  }
  await projector.disconnect();
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  say(
    `Listo: ${String(applied)} eventos reaplicados en ${seconds} s. La proyección se reconstruyó sola.`,
  );
} catch (error) {
  if (error instanceof GroupActiveError) {
    say(`No se puede reprocesar: ${error.message}.`);
    process.exitCode = 1;
  } else {
    say(`Error: ${error instanceof Error ? error.message : String(error)}`);
    say('El comando es idempotente: puede repetirse.');
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
