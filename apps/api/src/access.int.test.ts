import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { AuthService, loadAuthConfig, type Role } from '@bidstream/auth';
import { FixedClock } from '@bidstream/domain';
import { createTestDatabase, type TestDatabase } from '@bidstream/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { JwtBidderResolver, JwtTenantResolver } from './auth-context.js';
import { loadConfig } from './config.js';
import { Uuid7Generator } from './system.js';

// F1 parte 2: control de acceso por rol, denegar por defecto y creación de usuarios por un ADMIN.
const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '33333333-3333-4333-8333-333333333333';
const PASSWORD = 'una-contraseña-larga-123';
const NOW = new Date('2026-11-14T12:00:00.000Z');
const keys = generateKeyPairSync('ed25519');
const authConfig = loadAuthConfig({
  AUTH_JWT_PRIVATE_KEY: Buffer.from(
    keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  ).toString('base64'),
  AUTH_JWT_KEY_ID: 'k1',
});

let db: TestDatabase;
let app: FastifyInstance;
let service: AuthService;
const tokens = {} as Record<Role, string>;
const other = {} as { admin: string };

const call = (
  method: 'GET' | 'POST',
  url: string,
  token: string | undefined,
  payload?: unknown,
  extra: Record<string, string> = {},
) =>
  app.inject({
    method,
    url,
    headers: { ...(token === undefined ? {} : { authorization: `Bearer ${token}` }), ...extra },
    ...(payload === undefined ? {} : { payload: payload as never }),
  });

async function login(tenantId: string, email: string): Promise<string> {
  const res = await call('POST', '/v1/auth/login', undefined, {
    tenantId,
    email,
    password: PASSWORD,
  });
  return res.json<{ accessToken: string }>().accessToken;
}

beforeAll(async () => {
  db = await createTestDatabase();
  const clock = new FixedClock(NOW);
  service = new AuthService({ db: db.prisma, config: authConfig, now: () => clock.now() });
  app = buildApp({
    config: loadConfig({
      LOG_LEVEL: 'silent',
      NODE_ENV: 'production',
      AUTH_RATE_LIMIT_PER_MINUTE: '1000',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
    }),
    prisma: db.prisma,
    clock,
    ids: new Uuid7Generator(),
    tenantResolver: new JwtTenantResolver(),
    bidderResolver: new JwtBidderResolver(),
    eventsTopic: 'bidstream.events.lot',
    commandsTopic: 'bidstream.commands.bid',
    auth: { service, verifier: authConfig.verifier },
  });
  for (const role of ['ADMIN', 'SELLER', 'BIDDER'] as const) {
    const email = `${role.toLowerCase()}@ejemplo.com`;
    await service.createUser({ tenantId: TENANT, email, password: PASSWORD, role });
    tokens[role] = await login(TENANT, email);
  }
  await service.createUser({
    tenantId: OTHER_TENANT,
    email: 'admin@otro.com',
    password: PASSWORD,
    role: 'ADMIN',
  });
  other.admin = await login(OTHER_TENANT, 'admin@otro.com');
}, 60_000);

afterAll(async () => {
  await app.close();
  await db.drop();
});

const auctionBody = {
  title: 'Subasta',
  opensAt: '2026-11-15T10:00:00.000Z',
  closesAt: '2026-11-15T20:00:00.000Z',
};
const lotBody = {
  title: 'Lote',
  startingPrice: '100.00',
  minIncrement: '5.00',
  currency: 'USD',
  closesAt: '2026-11-15T18:00:00.000Z',
};
const KEY = { 'idempotency-key': 'clave-de-idempotencia-1234' };

describe('matriz de roles', () => {
  it.each([
    ['ADMIN', 201],
    ['SELLER', 201],
    ['BIDDER', 403],
  ] as const)('POST /v1/auctions como %s → %i', async (role, status) => {
    expect((await call('POST', '/v1/auctions', tokens[role], auctionBody)).statusCode).toBe(status);
  });

  it.each([
    ['ADMIN', 404], // pasa el control de acceso; la subasta no está proyectada → 404
    ['SELLER', 404],
    ['BIDDER', 403],
  ] as const)('POST /v1/auctions/:id/lots como %s → %i', async (role, status) => {
    expect(
      (await call('POST', `/v1/auctions/${randomUUID()}/lots`, tokens[role], lotBody)).statusCode,
    ).toBe(status);
  });

  it.each([
    ['ADMIN', 403],
    ['SELLER', 403],
    ['BIDDER', 404], // pasa el control de acceso; el lote no existe → 404
  ] as const)('POST /v1/lots/:id/bids como %s → %i', async (role, status) => {
    expect(
      (await call('POST', `/v1/lots/${randomUUID()}/bids`, tokens[role], { amount: '100.00' }, KEY))
        .statusCode,
    ).toBe(status);
  });

  it.each(['ADMIN', 'SELLER', 'BIDDER'] as const)(
    'GET /v1/auth/me lo puede usar %s',
    async (role) => {
      expect((await call('GET', '/v1/auth/me', tokens[role])).statusCode).toBe(200);
    },
  );

  it('el 403 es problem+json y no revela qué roles sí pueden', async () => {
    const res = await call('POST', '/v1/auctions', tokens.BIDDER, auctionBody);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ type: 'urn:bidstream:problem:forbidden', status: 403 });
    expect(res.body).not.toMatch(/SELLER|ADMIN/);
  });
});

describe('denegar por defecto', () => {
  it('sin token todo exige autenticación salvo salud, documentación y el inicio de sesión', async () => {
    for (const [method, url] of [
      ['POST', '/v1/auctions'],
      ['POST', `/v1/auctions/${randomUUID()}/lots`],
      ['POST', `/v1/lots/${randomUUID()}/bids`],
      ['GET', '/v1/auth/me'],
      ['POST', '/v1/auth/users'],
      ['GET', '/v1/admin/dlq'],
    ] as const) {
      const res = await call(method, url, undefined, method === 'POST' ? {} : undefined);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
    for (const url of ['/v1/health', '/v1/docs/json']) {
      expect((await call('GET', url, undefined)).statusCode, url).toBe(200);
    }
    const unauthenticated = await call('POST', '/v1/auth/login', undefined, {
      tenantId: TENANT,
      email: 'nadie@ejemplo.com',
      password: PASSWORD,
    });
    expect(unauthenticated.statusCode).toBe(401); // llega al manejador (credenciales), no al control de acceso
  });

  it('toda ruta registrada es pública o declara los roles que pueden usarla', () => {
    const routes = app.routeDeclarations.filter(
      (r) => !['HEAD', 'OPTIONS'].includes(String(r.method)),
    );
    expect(routes.length).toBeGreaterThan(8);
    const undeclared = routes.filter((r) => !r.public && r.roles.length === 0);
    expect(undeclared, JSON.stringify(undeclared)).toEqual([]);
  });

  it('una ruta nueva que olvida declarar sus roles queda denegada incluso con token válido', async () => {
    const strict = buildApp({
      config: loadConfig({
        LOG_LEVEL: 'silent',
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
      }),
      prisma: db.prisma,
      clock: new FixedClock(NOW),
      ids: new Uuid7Generator(),
      tenantResolver: new JwtTenantResolver(),
      eventsTopic: 'bidstream.events.lot',
      commandsTopic: 'bidstream.commands.bid',
      auth: { service, verifier: authConfig.verifier },
    });
    await strict.after(); // las defensas y los ganchos de acceso ya están cargados
    strict.get('/v1/olvidada', () => ({ secreto: true }));
    for (const role of ['ADMIN', 'SELLER', 'BIDDER'] as const) {
      const res = await strict.inject({
        method: 'GET',
        url: '/v1/olvidada',
        headers: { authorization: `Bearer ${tokens[role]}` },
      });
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain('secreto');
    }
    expect(
      strict.routeDeclarations.some(
        (r) => r.url === '/v1/olvidada' && !r.public && r.roles.length === 0,
      ),
    ).toBe(true);
    await strict.close();
  });
});

describe('creación de usuarios por un ADMIN', () => {
  it('un ADMIN crea SELLER, BIDDER y ADMIN en su propio tenant y ellos pueden entrar', async () => {
    for (const role of ['SELLER', 'BIDDER', 'ADMIN'] as const) {
      const email = `creado-${role.toLowerCase()}-${randomUUID().slice(0, 6)}@ejemplo.com`;
      const res = await call('POST', '/v1/auth/users', tokens.ADMIN, {
        email,
        password: PASSWORD,
        role,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ email, role });
      const me = await call('GET', '/v1/auth/me', await login(TENANT, email));
      expect(me.json()).toMatchObject({ tenantId: TENANT, role });
    }
  });

  it('el usuario nace en el tenant del administrador, no en uno elegido por él', async () => {
    const email = `ajeno-${randomUUID().slice(0, 6)}@ejemplo.com`;
    const res = await call('POST', '/v1/auth/users', other.admin, {
      email,
      password: PASSWORD,
      role: 'SELLER',
    });
    expect(res.statusCode).toBe(201);
    expect((await db.prisma.appUser.findFirstOrThrow({ where: { email } })).tenantId).toBe(
      OTHER_TENANT,
    );
    const extra = await call('POST', '/v1/auth/users', tokens.ADMIN, {
      email: `x-${randomUUID().slice(0, 6)}@ejemplo.com`,
      password: PASSWORD,
      role: 'SELLER',
      tenantId: OTHER_TENANT,
    });
    expect(extra.statusCode).toBe(400); // el tenant no se puede indicar en el cuerpo
  });

  it('SELLER y BIDDER no pueden crear usuarios; un rol inventado o una contraseña débil dan 400', async () => {
    const body = {
      email: `n-${randomUUID().slice(0, 6)}@ejemplo.com`,
      password: PASSWORD,
      role: 'SELLER',
    };
    expect((await call('POST', '/v1/auth/users', tokens.SELLER, body)).statusCode).toBe(403);
    expect((await call('POST', '/v1/auth/users', tokens.BIDDER, body)).statusCode).toBe(403);
    expect(
      (await call('POST', '/v1/auth/users', tokens.ADMIN, { ...body, role: 'SUPERADMIN' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call('POST', '/v1/auth/users', tokens.ADMIN, { ...body, password: 'corta' }))
        .statusCode,
    ).toBe(400);
  });
});

describe('modo header (solo desarrollo)', () => {
  it('no aplica el control por rol, pero la administración del DLQ sigue exigiendo un token ADMIN', async () => {
    const dev = buildApp({
      config: loadConfig({
        LOG_LEVEL: 'silent',
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
      }),
      prisma: db.prisma,
      clock: new FixedClock(NOW),
      ids: new Uuid7Generator(),
      tenantResolver: { resolve: () => TENANT },
      eventsTopic: 'bidstream.events.lot',
      commandsTopic: 'bidstream.commands.bid',
      auth: { service, verifier: authConfig.verifier },
      adminDlq: {
        port: {
          peek: () => Promise.reject(new Error('no debe llegar')),
          reprocess: () => Promise.reject(new Error('no debe llegar')),
        },
      },
    });
    expect((await dev.inject({ method: 'GET', url: '/v1/admin/dlq' })).statusCode).toBe(401);
    const asBidder = await dev.inject({
      method: 'GET',
      url: '/v1/admin/dlq',
      headers: { authorization: `Bearer ${tokens.BIDDER}` },
    });
    expect(asBidder.statusCode).toBe(403);
    await dev.close();
  });
});
