import { randomUUID } from 'node:crypto';
import { createEventConsumer } from '@bidstream/consumer';
import { reprocessDlq, type EventConsumer } from '@bidstream/consumer';
import { applyEventToProjection, PrismaOutbox } from '@bidstream/db';
import { buildEvent, partitionKey, type DomainEvent } from '@bidstream/domain';
import { createKafkaAdmin, createProducer, type KafkaProducer } from '@bidstream/kafka';
import { createLogger } from '@bidstream/logging';
import { OutboxRelay } from '@bidstream/relay';
import {
  createMessageVerifier,
  generateKeyPair,
  parsePrivateKey,
  parsePublicKey,
  signatureHeaders,
  SIGNATURE_HEADER,
  KEY_ID_HEADER,
  verifySignature,
  type SigningKey,
} from '@bidstream/signing';
import {
  collectMessages,
  createTestDatabase,
  createTestTopic,
  testKafkaConfig,
  waitFor,
  warmUpGroupCoordinator,
  type TestDatabase,
  type TestTopic,
} from '@bidstream/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { snapshotProjection } from './demo/fingerprint.js';
import { reprocessProjection, waitForLagZero } from './reprocess.js';

// F3: el relay firma, los consumidores verifican. Kafka, PostgreSQL y relay reales.
const kafka = testKafkaConfig();
const TENANT = '11111111-1111-4111-8111-111111111111';

const pair1 = generateKeyPair();
const pair2 = generateKeyPair();
const signer1: SigningKey = { kid: 'k1', key: parsePrivateKey(pair1.privateKey) };
const signer2: SigningKey = { kid: 'k2', key: parsePrivateKey(pair2.privateKey) };
const pub1 = parsePublicKey(pair1.publicKey);
const pub2 = parsePublicKey(pair2.publicKey);

let db: TestDatabase;
let producer: KafkaProducer;
let events: TestTopic;
let dlq: TestTopic;
const open: EventConsumer[] = [];

beforeAll(async () => {
  await warmUpGroupCoordinator();
  db = await createTestDatabase();
  producer = await createProducer(kafka);
}, 120_000);

afterAll(async () => {
  await producer.disconnect();
  await db.drop();
});

afterEach(async () => {
  await Promise.all(open.splice(0).map((c) => c.disconnect()));
  await Promise.all([events.drop(), dlq.drop()]);
});

async function topics(): Promise<void> {
  [events, dlq] = await Promise.all([createTestTopic({ partitions: 3 }), createTestTopic()]);
}

const auction = (title = 'Subasta'): DomainEvent & { type: 'AuctionOpened' } =>
  buildEvent('AuctionOpened', TENANT, {
    auctionId: randomUUID(),
    title,
    opensAt: '2026-11-14T10:00:00.000Z',
    closesAt: '2026-11-14T20:00:00.000Z',
  });

/** Publica el evento tal cual, firmado (o no) por quien se indique. */
async function publish(event: DomainEvent, signer?: SigningKey, value = JSON.stringify(event)) {
  await producer.publish(events.name, {
    key: partitionKey(event),
    value,
    headers: signer === undefined ? {} : signatureHeaders(JSON.stringify(event), signer),
  });
}

interface ProjectorOptions {
  readonly keys: Record<string, ReturnType<typeof parsePublicKey>>;
  readonly requiredFrom?: Date;
  readonly groupId?: string;
  readonly lines?: string[];
}

async function startProjector(options: ProjectorOptions): Promise<string> {
  const groupId = options.groupId ?? `projector-signing-${randomUUID()}`;
  const consumer = await createEventConsumer({
    kafka,
    prisma: db.prisma,
    consumerName: groupId,
    topics: [events.name],
    dlqTopic: dlq.name,
    retry: { baseDelayMs: 1, capMs: 2, maxRetries: 2 },
    verify: createMessageVerifier<DomainEvent>({
      mode: 'enforce',
      keys: new Map(Object.entries(options.keys)),
      requiredFrom: options.requiredFrom,
      timestampOf: (event) => event.occurredAt,
    }),
    ...(options.lines === undefined
      ? {}
      : { logger: createLogger({ service: 'projector', write: (l) => options.lines?.push(l) }) }),
    handler: (event, { tx }) => applyEventToProjection(tx, event),
  });
  open.push(consumer);
  void consumer.run();
  return groupId;
}

const exists = async (auctionId: string): Promise<boolean> =>
  (await db.prisma.auction.count({ where: { id: auctionId } })) === 1;

const deadLetters = (count: number) =>
  collectMessages({ topic: dlq.name, count, timeoutMs: 60_000 });

describe('el relay firma', () => {
  it('publica x-signature y x-key-id, y la firma verifica con la clave pública', async () => {
    await topics();
    const event = auction();
    await new PrismaOutbox(db.prisma).enqueue([event], events.name);
    const relay = new OutboxRelay({
      prisma: db.prisma,
      signer: signer1,
      publish: (r) => producer.publish(r.topic, { key: r.key, value: r.value, headers: r.headers }),
    });
    const collecting = collectMessages({ topic: events.name, count: 1 });
    await relay.runOnce();
    const [message] = await collecting;
    expect(message?.headers[KEY_ID_HEADER]).toBe('k1');
    const signature = message?.headers[SIGNATURE_HEADER] ?? '';
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifySignature(message?.value ?? '', signature, pub1)).toBe(true);
    expect(verifySignature(message?.value ?? '', signature, pub2)).toBe(false);
  });

  it('sin clave de firma publica sin cabeceras de firma', async () => {
    await topics();
    await new PrismaOutbox(db.prisma).enqueue([auction()], events.name);
    const relay = new OutboxRelay({
      prisma: db.prisma,
      publish: (r) => producer.publish(r.topic, { key: r.key, value: r.value, headers: r.headers }),
    });
    const collecting = collectMessages({ topic: events.name, count: 1 });
    await relay.runOnce();
    const [message] = await collecting;
    expect(message?.headers[SIGNATURE_HEADER]).toBeUndefined();
  });
});

describe('el consumidor verifica (A08)', () => {
  it('un evento firmado se aplica y uno manipulado en el topic va al DLQ como veneno sin aplicarse', async () => {
    await topics();
    const good = auction('Buena');
    const tampered = auction('Original');
    // se firma el contenido original pero se publica uno distinto: alguien tocó el topic
    const forged = JSON.stringify({
      ...tampered,
      payload: { ...tampered.payload, title: 'Manipulada' },
    });
    await startProjector({ keys: { k1: pub1 } });
    await publish(tampered, signer1, forged);
    await publish(good, signer1);
    await waitFor(() => exists(good.payload.auctionId), {
      description: 'el evento bueno se aplica',
    });

    const [dead] = await deadLetters(1);
    expect(JSON.parse(dead?.value ?? '{}')).toMatchObject({ reason: 'poison', attempts: 1 });
    expect(await exists(tampered.payload.auctionId)).toBe(false); // jamás se aplicó
  });

  it('sin firma, con firma de otra clave o con un kid desconocido: DLQ y no se aplican', async () => {
    await topics();
    const unsigned = auction();
    const otherKey = auction();
    const unknownKid = auction();
    await startProjector({ keys: { k1: pub1 } });
    await publish(unsigned);
    await publish(otherKey, signer2); // firmada con k2 pero declarando k2: no está en las claves
    await publish(unknownKid, { kid: 'desconocida', key: signer1.key });
    expect(await deadLetters(3)).toHaveLength(3);
    for (const e of [unsigned, otherKey, unknownKid])
      expect(await exists(e.payload.auctionId)).toBe(false);
  });

  it('rotación: se aceptan dos kid y, retirado uno, lo firmado con él deja de aceptarse', async () => {
    await topics();
    const a = auction();
    const b = auction();
    await startProjector({ keys: { k1: pub1, k2: pub2 } });
    await publish(a, signer1);
    await publish(b, signer2);
    await waitFor(
      async () => (await exists(a.payload.auctionId)) && (await exists(b.payload.auctionId)),
      {
        description: 'ambos kid se aceptan',
      },
    );

    const retired = auction();
    await open.pop()?.disconnect(); // el proyector anterior (con k1) se apaga
    await startProjector({ keys: { k2: pub2 } }); // k1 retirada
    await publish(retired, signer1);
    expect(await deadLetters(1)).toHaveLength(1);
    expect(await exists(retired.payload.auctionId)).toBe(false);
  });

  it('el historial sin firma anterior al corte se acepta y el posterior, no', async () => {
    await topics();
    const old = { ...auction('Histórica'), occurredAt: '2026-11-01T10:00:00.000Z' };
    const recent = { ...auction('Reciente'), occurredAt: '2026-11-14T10:00:00.000Z' };
    await startProjector({
      keys: { k1: pub1 },
      requiredFrom: new Date('2026-11-10T00:00:00.000Z'),
    });
    await publish(old);
    await publish(recent);
    await waitFor(() => exists(old.payload.auctionId), { description: 'el historial se acepta' });
    expect(await deadLetters(1)).toHaveLength(1);
    expect(await exists(recent.payload.auctionId)).toBe(false);
  });
});

describe('reproceso con historial mezclado (ADR-0009)', () => {
  it('reconstruir desde earliest con eventos sin firma anteriores al corte y firmados después da el mismo estado', async () => {
    await topics();
    const history = [
      { ...auction('H1'), occurredAt: '2026-11-01T10:00:00.000Z' },
      { ...auction('H2'), occurredAt: '2026-11-02T10:00:00.000Z' },
    ];
    const signed = [auction('S1'), auction('S2'), auction('S3')];
    for (const e of history) await publish(e);
    for (const e of signed) await publish(e, signer1);

    const groupId = await startProjector({
      keys: { k1: pub1 },
      requiredFrom: new Date('2026-11-10T00:00:00.000Z'),
    });
    const ids = [...history, ...signed].map((e) => e.payload.auctionId);
    await waitFor(
      async () => (await db.prisma.auction.count({ where: { id: { in: ids } } })) === 5,
      {
        description: 'todo el historial proyectado',
      },
    );
    const admin = await createKafkaAdmin(kafka);
    await waitForLagZero(admin, groupId, events.name, { timeoutMs: 30_000 });
    const rows = () =>
      db.prisma.auction.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
    const before = JSON.stringify(await rows());

    // se detiene, se borra la proyección y se reconstruye desde earliest con el mismo verificador
    await open.pop()?.disconnect();
    await reprocessProjection({ prisma: db.prisma, kafka, yes: true, topic: events.name, groupId });
    expect((await snapshotProjection(db.prisma)).auctions).toBe(0);
    await startProjector({
      keys: { k1: pub1 },
      requiredFrom: new Date('2026-11-10T00:00:00.000Z'),
      groupId,
    });
    await waitForLagZero(admin, groupId, events.name, { timeoutMs: 30_000 });
    await admin.disconnect();
    expect(JSON.stringify(await rows())).toBe(before);
  }, 120_000);
});

describe('DLQ (D7) y secretos', () => {
  it('el reproceso del DLQ conserva la firma: el evento reprocesado se verifica y se aplica', async () => {
    await topics();
    // un BidPlaced firmado cuyo lote aún no existe: la proyección lanza y se agota el reintento
    const lotId = randomUUID();
    const bid = buildEvent('BidPlaced', TENANT, {
      lotId,
      bidderId: randomUUID(),
      amount: '100.00',
      placedAt: '2026-11-14T12:00:00.000Z',
    });
    await startProjector({ keys: { k1: pub1 } });
    await publish(bid, signer1);
    const [dead] = await deadLetters(1);
    const body = JSON.parse(dead?.value ?? '{}') as {
      reason: string;
      signature?: string;
      keyId?: string;
    };
    expect(body).toMatchObject({ reason: 'retries-exhausted', keyId: 'k1' });
    expect(body.signature).toMatch(/^[A-Za-z0-9_-]+$/);

    // ahora existe el lote (firmado), y se reprocesa el DLQ
    const lot = buildEvent('LotPublished', TENANT, {
      lotId,
      auctionId: randomUUID(),
      title: 'Lote',
      startingPrice: '100.00',
      minIncrement: '5.00',
      currency: 'USD',
      closesAt: '2026-11-14T18:00:00.000Z',
    });
    await publish(lot, signer1);
    await waitFor(async () => (await db.prisma.lot.count({ where: { id: lotId } })) === 1, {
      description: 'el lote se proyecta',
    });
    const summary = await reprocessDlq({
      kafka,
      dlqTopic: dlq.name,
      reprocessorGroup: `dlq-reprocessor-${randomUUID()}`,
      eventIds: [bid.eventId],
    });
    expect(summary.republished).toBe(1);
    await waitFor(async () => (await db.prisma.bid.count({ where: { lotId } })) === 1, {
      description: 'la puja reprocesada se verifica y se aplica',
      timeoutMs: 60_000,
    });
  }, 120_000);

  it('la clave privada nunca aparece en logs ni en el DLQ', async () => {
    await topics();
    const lines: string[] = [];
    await startProjector({ keys: { k1: pub1 }, lines });
    await publish(auction());
    const [dead] = await deadLetters(1);
    const everything = `${lines.join('\n')}\n${dead?.value ?? ''}`;
    const secret = pair1.privateKey.replace(/-----[A-Z ]+-----|\s/g, '');
    expect(secret.length).toBeGreaterThan(20);
    expect(everything).not.toContain(secret);
    expect(everything).not.toContain(Buffer.from(pair1.privateKey).toString('base64'));
  });
});
