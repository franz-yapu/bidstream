import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { AuthService, loadAuthConfig, type AuthConfig } from '@bidstream/auth';
import type { Clock } from '@bidstream/domain';
import { createTestDatabase, type TestDatabase } from '@bidstream/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { JwtBidderResolver, JwtTenantResolver } from './auth-context.js';
import { bootstrapAdmin } from './bootstrap-admin.js';
import { loadConfig } from './config.js';
import { Uuid7Generator } from './system.js';

// F1: autenticación por HTTP contra PostgreSQL real (sin Kafka: nada se publica).
const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '33333333-3333-4333-8333-333333333333';
const PASSWORD = 'una-contraseña-larga-123';
const keys = generateKeyPairSync('ed25519');
const authConfig: AuthConfig = loadAuthConfig({
  AUTH_JWT_PRIVATE_KEY: Buffer.from(
    keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  ).toString('base64'),
  AUTH_JWT_KEY_ID: 'k1',
});

class MutableClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

let db: TestDatabase;
let app: FastifyInstance;
let service: AuthService;
const clock = new MutableClock(new Date('2026-11-14T12:00:00.000Z'));
const logs: string[] = [];

beforeAll(async () => {
  db = await createTestDatabase();
  service = new AuthService({ db: db.prisma, config: authConfig, now: () => clock.now() });
  app = buildApp({
    config: loadConfig({
      LOG_LEVEL: 'info',
      NODE_ENV: 'test',
      AUTH_MODE: 'jwt',
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
    logStream: { write: (chunk) => void logs.push(chunk) },
  });
});

afterAll(async () => {
  await app.close();
  await db.drop();
});

const email = (): string => `usuario-${randomUUID().slice(0, 8)}@ejemplo.com`;
const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: payload as never, headers });

async function registerAndLogin(tenantId = TENANT) {
  const address = email();
  const registered = await post('/v1/auth/register', {
    tenantId,
    email: address,
    password: PASSWORD,
  });
  expect(registered.statusCode).toBe(201);
  const login = await post('/v1/auth/login', { tenantId, email: address, password: PASSWORD });
  expect(login.statusCode).toBe(200);
  const tokens = login.json<{ accessToken: string; refreshToken: string }>();
  return { address, userId: registered.json<{ userId: string }>().userId, ...tokens };
}

/** Crea un usuario del rol indicado (lo hace el servicio: el registro público solo crea postores) y entra. */
async function userWithRole(role: 'ADMIN' | 'SELLER' | 'BIDDER', tenantId = TENANT) {
  const address = email();
  const user = await service.createUser({ tenantId, email: address, password: PASSWORD, role });
  const login = await post('/v1/auth/login', { tenantId, email: address, password: PASSWORD });
  return { ...user, accessToken: login.json<{ accessToken: string }>().accessToken };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('flujo', () => {
  it('registro → login → me → refresh → logout', async () => {
    const { address, userId, accessToken, refreshToken } = await registerAndLogin();
    const me = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(accessToken),
    });
    expect(me.json()).toEqual({ userId, tenantId: TENANT, role: 'BIDDER', email: address });

    const refreshed = await post('/v1/auth/refresh', { refreshToken });
    expect(refreshed.statusCode).toBe(200);
    const next = refreshed.json<{ accessToken: string; refreshToken: string }>();
    expect(next.refreshToken).not.toBe(refreshToken);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(next.accessToken) }))
        .statusCode,
    ).toBe(200);

    expect((await post('/v1/auth/logout', { refreshToken: next.refreshToken })).statusCode).toBe(
      204,
    );
    expect((await post('/v1/auth/refresh', { refreshToken: next.refreshToken })).statusCode).toBe(
      401,
    );
  });

  it('el registro solo crea BIDDER aunque se pida otro rol, y no acepta campos extra', async () => {
    const res = await post('/v1/auth/register', {
      tenantId: TENANT,
      email: email(),
      password: PASSWORD,
      role: 'ADMIN',
    });
    expect(res.statusCode).toBe(400);
    const ok = await post('/v1/auth/register', {
      tenantId: TENANT,
      email: email(),
      password: PASSWORD,
    });
    expect(ok.json<{ role: string }>().role).toBe('BIDDER');
  });

  it('una contraseña débil → 400 con el motivo; un correo repetido → 409 genérico', async () => {
    const weak = await post('/v1/auth/register', {
      tenantId: TENANT,
      email: email(),
      password: 'corta',
    });
    expect(weak.statusCode).toBe(400);
    expect(weak.json<{ errors: { message: string }[] }>().errors[0]?.message).toContain(
      '12 caracteres',
    );
    const { address } = await registerAndLogin();
    const dup = await post('/v1/auth/register', {
      tenantId: TENANT,
      email: address,
      password: PASSWORD,
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.body).not.toContain(address);
  });
});

describe('credenciales y bloqueo (A07)', () => {
  const strip = (body: string) => ({
    ...(JSON.parse(body) as Record<string, unknown>),
    requestId: undefined,
  });

  it('usuario inexistente, contraseña incorrecta y tenant equivocado: respuestas idénticas', async () => {
    const { address } = await registerAndLogin();
    const [unknownUser, wrongPassword, wrongTenant] = await Promise.all([
      post('/v1/auth/login', { tenantId: TENANT, email: 'nadie@ejemplo.com', password: PASSWORD }),
      post('/v1/auth/login', {
        tenantId: TENANT,
        email: address,
        password: 'contraseña-incorrecta-1',
      }),
      post('/v1/auth/login', { tenantId: OTHER_TENANT, email: address, password: PASSWORD }),
    ]);
    for (const res of [unknownUser, wrongPassword, wrongTenant]) {
      expect(res.statusCode).toBe(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.headers['www-authenticate']).toBe('Bearer');
    }
    expect(strip(wrongPassword.body)).toEqual(strip(unknownUser.body));
    expect(strip(wrongTenant.body)).toEqual(strip(unknownUser.body));
  });

  it('5 fallos bloquean 15 minutos y la respuesta no cambia; después puede entrar', async () => {
    const { address } = await registerAndLogin();
    const bad = { tenantId: TENANT, email: address, password: 'contraseña-incorrecta-1' };
    for (let i = 0; i < 5; i++) expect((await post('/v1/auth/login', bad)).statusCode).toBe(401);
    const locked = await post('/v1/auth/login', { ...bad, password: PASSWORD });
    expect(locked.statusCode).toBe(401); // bloqueada: ni la contraseña correcta entra
    expect(locked.json<{ detail: string }>().detail).toBe('Credenciales inválidas.');
    clock.advance(16 * 60_000);
    expect((await post('/v1/auth/login', { ...bad, password: PASSWORD })).statusCode).toBe(200);
  });

  it('reutilizar un refresh token ya usado revoca la familia', async () => {
    const { refreshToken } = await registerAndLogin();
    const second = (await post('/v1/auth/refresh', { refreshToken })).json<{
      refreshToken: string;
    }>();
    expect((await post('/v1/auth/refresh', { refreshToken })).statusCode).toBe(401); // robo
    expect((await post('/v1/auth/refresh', { refreshToken: second.refreshToken })).statusCode).toBe(
      401,
    );
  });
});

describe('access token', () => {
  it.each([
    ['ausente', undefined],
    ['sin Bearer', 'Basic abc'],
    ['mal formado', 'Bearer no-es-un-jwt'],
    ['vacío', 'Bearer '],
  ])('%s → 401 con WWW-Authenticate', async (_name, header) => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: header === undefined ? {} : { authorization: header },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('un token caducado se rechaza', async () => {
    const { accessToken } = await registerAndLogin();
    clock.advance(11 * 60_000); // más de los 10 minutos de vida
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(accessToken),
    });
    expect(res.statusCode).toBe(401);
  });

  it('un token alterado o de un usuario deshabilitado se rechaza', async () => {
    const { accessToken, userId } = await registerAndLogin();
    const [h, p, s] = accessToken.split('.');
    const tampered = `${h ?? ''}.${p ?? ''}.${(s ?? '').slice(0, -3)}AAA`;
    expect(
      (await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(tampered) }))
        .statusCode,
    ).toBe(401);
    await db.prisma.appUser.update({ where: { id: userId }, data: { status: 'DISABLED' } });
    expect(
      (await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(accessToken) }))
        .statusCode,
    ).toBe(401);
  });
});

describe('la identidad sale del token, no de cabeceras', () => {
  const auction = {
    title: 'Subasta',
    opensAt: '2026-11-15T10:00:00.000Z',
    closesAt: '2026-11-15T20:00:00.000Z',
  };

  it('sin token los comandos dan 401; las cabeceras X-Tenant-Id y X-Bidder-Id se ignoran', async () => {
    expect((await post('/v1/auctions', auction, { 'x-tenant-id': TENANT })).statusCode).toBe(401);
    const { accessToken } = await userWithRole('SELLER');
    const before = await db.prisma.outboxMessage.count();
    const res = await post('/v1/auctions', auction, {
      ...bearer(accessToken),
      'x-tenant-id': OTHER_TENANT,
    });
    expect(res.statusCode).toBe(201);
    const row = await db.prisma.outboxMessage.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    expect(await db.prisma.outboxMessage.count()).toBe(before + 1);
    expect((row.payload as { tenantId: string }).tenantId).toBe(TENANT); // el del token, no el de la cabecera
  });

  it('la puja usa como postor al usuario del token aunque se envíe otro X-Bidder-Id', async () => {
    const { accessToken, userId } = await registerAndLogin();
    const lotId = randomUUID();
    await db.prisma.lot.create({
      data: {
        id: lotId,
        auctionId: randomUUID(),
        tenantId: TENANT,
        title: 'Lote',
        startingPrice: '100.00',
        minIncrement: '5.00',
        currency: 'USD',
        closesAt: new Date('2026-11-15T13:00:00.000Z'),
        status: 'OPEN',
      },
    });
    const res = await post(
      `/v1/lots/${lotId}/bids`,
      { amount: '100.00' },
      {
        ...bearer(accessToken),
        'x-bidder-id': randomUUID(),
        'idempotency-key': `clave-${randomUUID()}`,
      },
    );
    expect(res.statusCode).toBe(202);
    const row = await db.prisma.outboxMessage.findUniqueOrThrow({
      where: { id: res.json<{ commandId: string }>().commandId },
    });
    expect((row.payload as { payload: { bidderId: string } }).payload.bidderId).toBe(userId);
  });

  it('un postor de otro tenant no ve el lote: 404', async () => {
    const { accessToken } = await registerAndLogin(OTHER_TENANT);
    const lot = await db.prisma.lot.findFirstOrThrow({ where: { tenantId: TENANT } });
    const res = await post(
      `/v1/lots/${lot.id}/bids`,
      { amount: '100.00' },
      { ...bearer(accessToken), 'idempotency-key': `clave-${randomUUID()}` },
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('secretos y límites', () => {
  it('contraseñas, hashes y tokens nunca salen en los logs ni en las respuestas de error', async () => {
    const address = email();
    const secret = 'esta-es-una-contraseña-única-9876';
    await post('/v1/auth/register', { tenantId: TENANT, email: address, password: secret });
    const bad = await post('/v1/auth/login', {
      tenantId: TENANT,
      email: address,
      password: `${secret}x`,
    });
    const ok = await post('/v1/auth/login', { tenantId: TENANT, email: address, password: secret });
    const tokens = ok.json<{ accessToken: string; refreshToken: string }>();
    await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(tokens.accessToken) });
    const everything = `${logs.join('')}${bad.body}`;
    for (const sensitive of [secret, `${secret}x`, tokens.refreshToken, '$argon2id$']) {
      expect(everything).not.toContain(sensitive);
    }
    expect(
      JSON.stringify(await db.prisma.appUser.findFirst({ where: { email: address } })),
    ).not.toContain(secret);
  });

  it('la API arranca y atiende con NODE_ENV=production en modo jwt', async () => {
    const prod = buildApp({
      config: loadConfig({
        LOG_LEVEL: 'silent',
        NODE_ENV: 'production',
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
    expect((await prod.inject({ method: 'GET', url: '/v1/health' })).statusCode).toBe(200);
    await prod.close();
  });

  it('el límite por IP en /v1/auth/* responde 429 problem+json con Retry-After', async () => {
    const limited = buildApp({
      config: loadConfig({
        LOG_LEVEL: 'silent',
        NODE_ENV: 'test',
        AUTH_MODE: 'jwt',
        AUTH_RATE_LIMIT_PER_MINUTE: '3',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
      }),
      prisma: db.prisma,
      clock,
      ids: new Uuid7Generator(),
      tenantResolver: new JwtTenantResolver(),
      eventsTopic: 'bidstream.events.lot',
      commandsTopic: 'bidstream.commands.bid',
      auth: { service, verifier: authConfig.verifier },
    });
    const statuses: number[] = [];
    let last = { headers: {} as Record<string, unknown>, body: '' };
    for (let i = 0; i < 5; i++) {
      const res = await limited.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { tenantId: TENANT, email: 'nadie@ejemplo.com', password: PASSWORD },
      });
      statuses.push(res.statusCode);
      last = res;
    }
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
    expect(last.headers['content-type']).toContain('application/problem+json');
    expect(last.headers['retry-after']).toBeDefined();
    await limited.close();
  });
});

describe('administrador inicial', () => {
  const config = {
    BOOTSTRAP_ADMIN_TENANT_ID: TENANT,
    BOOTSTRAP_ADMIN_EMAIL: 'admin-inicial@ejemplo.com',
    BOOTSTRAP_ADMIN_PASSWORD: 'contraseña-del-admin-1',
  };

  it('se crea una sola vez y no cambia la contraseña de un administrador existente', async () => {
    expect(await bootstrapAdmin(service, db.prisma, config)).toBe(true);
    expect(await bootstrapAdmin(service, db.prisma, config)).toBe(false);
    expect(
      await bootstrapAdmin(service, db.prisma, {
        ...config,
        BOOTSTRAP_ADMIN_PASSWORD: 'otra-contraseña-distinta',
      }),
    ).toBe(false);
    const login = await post('/v1/auth/login', {
      tenantId: TENANT,
      email: config.BOOTSTRAP_ADMIN_EMAIL,
      password: config.BOOTSTRAP_ADMIN_PASSWORD,
    });
    expect(login.statusCode).toBe(200);
    const me = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(login.json<{ accessToken: string }>().accessToken),
    });
    expect(me.json<{ role: string }>().role).toBe('ADMIN');
  });

  it('sin configuración no hace nada', async () => {
    expect(await bootstrapAdmin(service, db.prisma, {})).toBe(false);
  });
});
