import { writeFileSync } from 'node:fs';
import { buildApp, HeaderTenantResolver, loadConfig, Uuid7Generator } from '@bidstream/api';
import { PrismaOutbox, createPrismaClient } from '@bidstream/db';
import { buildEvent, FixedClock, type DomainEvent } from '@bidstream/domain';
import { createKafkaAdmin, createProducer, loadKafkaConfig } from '@bidstream/kafka';
import { OutboxRelay } from '@bidstream/relay';
import { loadProjectorConfig } from '../config.js';
import { createProjector } from '../projector.js';
import { waitForLagZero } from '../reprocess.js';
import { snapshotProjection } from './fingerprint.js';

/**
 * Fase 1 de la demostración del reproceso (docs/sdd/H5/SDD.md): genera un historial determinista
 * (subastas y lotes por la API real, pujas y cierres por el outbox), lo publica con el relay y lo
 * proyecta con el projector; imprime la huella del estado y la guarda para compararla después.
 *
 *   node --import tsx apps/projector/src/demo/load.ts <archivo-de-huella> [subastas] [lotes] [pujas]
 */
const [fingerprintFile, auctionsArg, lotsArg, bidsArg] = process.argv.slice(2);
if (fingerprintFile === undefined) throw new Error('falta el archivo donde guardar la huella');
const AUCTIONS = Number(auctionsArg ?? 2);
const LOTS_PER_AUCTION = Number(lotsArg ?? 10);
const BIDS_PER_LOT = Number(bidsArg ?? 20);

const config = loadProjectorConfig(process.env);
const kafka = loadKafkaConfig({ KAFKA_CLIENT_ID: 'bidstream-demo', ...process.env });
const prisma = createPrismaClient(config.DATABASE_URL);
const topic = config.PROJECTOR_TOPIC;
const TENANT = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-13T12:00:00.000Z');
const say = (message: string): void => {
  console.log(message);
};

// PRNG determinista: importes y postores se repiten en cada ejecución (los ids de subastas y lotes
// los genera la API y cambian, por eso la huella solo se compara dentro de una misma ejecución).
let seed = 20261113;
const random = (): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const bidders = Array.from(
  { length: 8 },
  (_, i) => `0000000${String(i)}-0000-4000-8000-000000000000`,
);

const app = buildApp({
  config: loadConfig({
    LOG_LEVEL: 'silent',
    NODE_ENV: 'development',
    DATABASE_URL: config.DATABASE_URL,
  }),
  prisma,
  clock: new FixedClock(NOW),
  ids: new Uuid7Generator(),
  tenantResolver: new HeaderTenantResolver(),
  eventsTopic: topic,
});
const producer = await createProducer(kafka);
const relay = new OutboxRelay({
  prisma,
  publish: (r) => producer.publish(r.topic, { key: r.key, value: r.value, headers: r.headers }),
});
const admin = await createKafkaAdmin(kafka);
const projector = await createProjector({
  kafka,
  prisma,
  groupId: config.PROJECTOR_GROUP_ID,
  topics: [topic],
});
void projector.run();

/** Publica lo pendiente del outbox y espera a que el projector lo haya proyectado. */
async function settle(): Promise<void> {
  for (;;) {
    const { published } = await relay.runOnce();
    if (published === 0) break;
  }
  await waitForLagZero(admin, config.PROJECTOR_GROUP_ID, topic, { timeoutMs: 120_000 });
}

try {
  const headers = { 'x-tenant-id': TENANT };
  say(
    `Generando ${String(AUCTIONS)} subastas, ${String(AUCTIONS * LOTS_PER_AUCTION)} lotes y pujas…`,
  );

  const auctionIds: string[] = [];
  for (let a = 0; a < AUCTIONS; a++) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auctions',
      headers,
      payload: {
        title: `Subasta ${String(a + 1)}`,
        opensAt: '2026-11-14T10:00:00.000Z',
        closesAt: '2026-11-14T20:00:00.000Z',
      },
    });
    auctionIds.push(res.json<{ auctionId: string }>().auctionId);
  }
  await settle();

  const lotIds: string[] = [];
  for (const auctionId of auctionIds) {
    for (let l = 0; l < LOTS_PER_AUCTION; l++) {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/auctions/${auctionId}/lots`,
        headers,
        payload: {
          title: `Lote ${String(lotIds.length + 1)}`,
          startingPrice: '100.00',
          minIncrement: '5.00',
          currency: 'USD',
          closesAt: '2026-11-14T18:00:00.000Z',
        },
      });
      lotIds.push(res.json<{ lotId: string }>().lotId);
    }
  }
  await settle();

  const events: DomainEvent[] = [];
  for (const lotId of lotIds) {
    let amount = 100;
    let last = bidders[0] ?? '';
    for (let b = 0; b < BIDS_PER_LOT; b++) {
      amount += 5 * (1 + Math.floor(random() * 3));
      last = bidders[Math.floor(random() * bidders.length)] ?? last;
      events.push(
        buildEvent('BidPlaced', TENANT, {
          lotId,
          bidderId: last,
          amount: amount.toFixed(2),
          placedAt: `2026-11-14T1${String(1 + (b % 6))}:${String(10 + b).padStart(2, '0')}:00.000Z`,
        }),
      );
    }
    events.push(
      buildEvent('LotClosed', TENANT, { lotId, winnerId: last, finalAmount: amount.toFixed(2) }),
    );
  }
  await new PrismaOutbox(prisma).enqueue(events, topic);
  await settle();

  const snap = await snapshotProjection(prisma);
  const { total } = await admin.consumerLag(config.PROJECTOR_GROUP_ID, topic);
  say('');
  say(
    `Proyección: subastas=${String(snap.auctions)} lotes=${String(snap.lots)} pujas=${String(snap.bids)} adjudicadas=${String(snap.awarded)}`,
  );
  say(`Huella:     ${snap.fingerprint}`);
  say(`Lag del grupo ${config.PROJECTOR_GROUP_ID}: ${String(total)}`);
  writeFileSync(fingerprintFile, `${snap.fingerprint}\n`);
} finally {
  await projector.disconnect();
  await producer.disconnect();
  await admin.disconnect();
  await app.close();
  await prisma.$disconnect();
}
