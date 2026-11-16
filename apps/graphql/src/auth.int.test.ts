import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { loadAuthConfig, signAccessToken, type Role } from '@bidstream/auth';
import { applyEventToProjection, createPrismaClient } from '@bidstream/db';
import { buildEvent } from '@bidstream/domain';
import { createTestDatabase, type TestDatabase } from '@bidstream/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { buildYoga } from './server.js';

// F1: GraphQL verifica el mismo JWT que emite la API y solo lee lo del tenant del token.
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-14T12:00:00.000Z');
const keys = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');
const pem = (key: typeof keys.privateKey): string =>
  Buffer.from(key.export({ type: 'pkcs8', format: 'pem' }).toString()).toString('base64');
const issuer = loadAuthConfig({
  AUTH_JWT_PRIVATE_KEY: pem(keys.privateKey),
  AUTH_JWT_KEY_ID: 'k1',
});
// quien solo verifica no tiene la clave privada
const verifierConfig = loadAuthConfig({
  AUTH_JWT_PUBLIC_KEYS: JSON.stringify({
    k1: Buffer.from(keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()).toString(
      'base64',
    ),
  }),
});
const config = loadConfig({
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  AUTH_MODE: 'jwt',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
});

let db: TestDatabase;
let prisma: ReturnType<typeof createPrismaClient>;
let yoga: ReturnType<typeof buildYoga>;
const auctionA = randomUUID();
const auctionB = randomUUID();

const token = (
  role: Role,
  tenantId: string,
  at: Date = NOW,
  signer = issuer.signer,
): Promise<string> => {
  if (signer === null) throw new Error('sin clave');
  return signAccessToken(signer, { userId: randomUUID(), tenantId, role }, 600, at);
};

beforeAll(async () => {
  db = await createTestDatabase();
  prisma = createPrismaClient(db.url);
  for (const [tenantId, auctionId] of [
    [TENANT_A, auctionA],
    [TENANT_B, auctionB],
  ] as const) {
    await prisma.$transaction((tx) =>
      applyEventToProjection(
        tx,
        buildEvent('AuctionOpened', tenantId, {
          auctionId,
          title: `Subasta de ${tenantId.slice(0, 4)}`,
          opensAt: '2026-11-14T10:00:00.000Z',
          closesAt: '2026-11-14T20:00:00.000Z',
        }),
      ),
    );
  }
  yoga = buildYoga({ config, db: prisma, verifier: verifierConfig.verifier, now: () => NOW });
});

afterAll(async () => {
  await prisma.$disconnect();
  await db.drop();
});

async function query(auctionId: string, headers: Record<string, string>) {
  const response = await yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/graphql-response+json',
      ...headers,
    },
    body: JSON.stringify({ query: '{ auction(id: "' + auctionId + '") { id title } }' }),
  });
  return {
    status: response.status,
    body: (await response.json()) as {
      data?: { auction: { id: string } | null } | null;
      errors?: { message: string; extensions?: { code?: string } }[];
    },
  };
}

describe('lecturas con token', () => {
  it.each(['ADMIN', 'SELLER', 'BIDDER'] as const)('un %s lee lo de su tenant', async (role) => {
    const res = await query(auctionA, { authorization: `Bearer ${await token(role, TENANT_A)}` });
    expect(res.body.data?.auction?.id).toBe(auctionA);
  });

  it('aislamiento: con el token del tenant B no se ve la subasta del tenant A', async () => {
    const res = await query(auctionA, {
      authorization: `Bearer ${await token('ADMIN', TENANT_B)}`,
    });
    expect(res.body.data?.auction).toBeNull();
    const own = await query(auctionB, {
      authorization: `Bearer ${await token('ADMIN', TENANT_B)}`,
    });
    expect(own.body.data?.auction?.id).toBe(auctionB);
  });

  it('X-Tenant-Id se ignora: el tenant sale del token', async () => {
    const res = await query(auctionA, {
      authorization: `Bearer ${await token('BIDDER', TENANT_B)}`,
      'x-tenant-id': TENANT_A,
    });
    expect(res.body.data?.auction).toBeNull();
  });
});

describe('sin identidad válida: UNAUTHENTICATED', () => {
  it('sin token, con solo la cabecera de tenant, o con un esquema distinto de Bearer', async () => {
    for (const headers of [{}, { 'x-tenant-id': TENANT_A }, { authorization: 'Basic abc' }]) {
      const res = await query(auctionA, headers);
      expect(res.status).toBe(401);
      expect(res.body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    }
  });

  it('token caducado, alterado, firmado por otra clave o con un kid desconocido', async () => {
    const valid = await token('ADMIN', TENANT_A);
    const [h, p, s] = valid.split('.');
    const forgedSigner = loadAuthConfig({
      AUTH_JWT_PRIVATE_KEY: pem(other.privateKey),
      AUTH_JWT_KEY_ID: 'k1',
    }).signer;
    const unknownKid = loadAuthConfig({
      AUTH_JWT_PRIVATE_KEY: pem(keys.privateKey),
      AUTH_JWT_KEY_ID: 'otra',
    }).signer;
    const bad = [
      await token('ADMIN', TENANT_A, new Date(NOW.getTime() - 3_600_000)), // caducado hace una hora
      `${h ?? ''}.${p ?? ''}.${(s ?? '').slice(0, -3)}AAA`,
      await token('ADMIN', TENANT_A, NOW, forgedSigner),
      await token('ADMIN', TENANT_A, NOW, unknownKid),
      'no-es-un-jwt',
    ];
    for (const value of bad) {
      const res = await query(auctionA, { authorization: `Bearer ${value}` });
      expect(res.status, value.slice(0, 20)).toBe(401);
      expect(res.body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
      expect(JSON.stringify(res.body)).not.toContain(auctionA); // nada de datos
    }
  });
});

describe('configuración', () => {
  it('GraphQL arranca con NODE_ENV=production en modo jwt (ya no está bloqueado)', () => {
    const prod = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
    });
    expect(prod.AUTH_MODE).toBe('jwt');
    expect(prod.GQL_INTROSPECTION).toBe(false);
  });

  it('el modo jwt sin verificador falla de forma clara', async () => {
    const broken = buildYoga({ config, db: prisma });
    const response = await broken.fetch('http://localhost/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
      body: JSON.stringify({ query: '{ __typename }' }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

// J2 (ADR-0015): lectura anónima del tenant público y nombre público de los postores.
describe('visitante anónimo y nombre público', () => {
  const ANA = randomUUID();
  const BEN = randomUUID();
  const lotId = randomUUID();
  let anon: ReturnType<typeof buildYoga>;

  const run = async (
    source: string,
    headers: Record<string, string> = {},
    instance: ReturnType<typeof buildYoga> = anon,
  ) => {
    const response = await instance.fetch('http://localhost/graphql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/graphql-response+json',
        ...headers,
      },
      body: JSON.stringify({ query: source }),
    });
    return {
      status: response.status,
      text: await response.text(),
    };
  };

  beforeAll(async () => {
    for (const [id, displayName, email] of [
      [ANA, 'Ana Torres', 'ana@privado.test'],
      [BEN, 'Ben', 'ben@privado.test'],
    ] as const) {
      await prisma.appUser.create({
        data: { id, tenantId: TENANT_A, email, displayName, passwordHash: 'x', role: 'BIDDER' },
      });
    }
    await prisma.lot.create({
      data: {
        id: lotId,
        auctionId: auctionA,
        tenantId: TENANT_A,
        title: 'Reloj',
        startingPrice: '100.00',
        minIncrement: '5.00',
        currency: 'USD',
        closesAt: new Date('2026-11-14T20:00:00.000Z'),
        status: 'OPEN',
        currentPrice: '120.00',
        currentBidder: BEN,
      },
    });
    for (const [bidderId, amount, second] of [
      [ANA, '110.00', 1],
      [BEN, '120.00', 2],
    ] as const) {
      await prisma.bid.create({
        data: {
          id: randomUUID(),
          lotId,
          bidderId,
          amount,
          placedAt: new Date(NOW.getTime() + second * 1000),
        },
      });
    }
    anon = buildYoga({
      config: loadConfig({
        LOG_LEVEL: 'silent',
        NODE_ENV: 'test',
        AUTH_MODE: 'jwt',
        PUBLIC_TENANT_ID: TENANT_A,
        DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
      }),
      db: prisma,
      verifier: verifierConfig.verifier,
      now: () => NOW,
    });
  });

  const lotQuery = `{ lot(id: "${lotId}") { leader { displayName } winner { displayName }
    bids(first: 10) { edges { node { rank bidder { displayName } } } } } }`;

  it('sin credenciales lee el tenant público: líder e historial con nombre público', async () => {
    const res = await run(lotQuery);
    expect(res.status).toBe(200);
    const data = (JSON.parse(res.text) as { data: { lot: Record<string, unknown> } }).data.lot;
    expect(data['leader']).toEqual({ displayName: 'Ben' });
    expect(data['winner']).toBeNull();
    expect(JSON.stringify(data['bids'])).toContain('Ana Torres');
  });

  it('nunca devuelve el correo, el id del usuario ni el tenant', async () => {
    const res = await run(lotQuery);
    expect(res.text).not.toMatch(/privado\.test|@|bidderId|currentBidder/);
    expect(res.text).not.toContain(ANA);
    expect(res.text).not.toContain(BEN);
  });

  it('solo ve el tenant público: no hay forma de elegir otro', async () => {
    const res = await run(`{ auction(id: "${auctionB}") { id } }`);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toMatchObject({ data: { auction: null } });
  });

  it('un token inválido no se degrada a anónimo', async () => {
    const res = await run(lotQuery, { authorization: 'Bearer basura' });
    expect(res.status).toBe(401);
    expect(res.text).toContain('UNAUTHENTICATED');
  });

  it('sin PUBLIC_TENANT_ID el anónimo sigue rechazado', async () => {
    const res = await run(lotQuery, {}, yoga);
    expect(res.status).toBe(401);
  });
});
