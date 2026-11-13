import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { AuthService, loadAuthConfig } from '@bidstream/auth';
import { FixedClock } from '@bidstream/domain';
import { createTestDatabase, type TestDatabase } from '@bidstream/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { JwtBidderResolver, JwtTenantResolver } from './auth-context.js';
import { loadConfig } from './config.js';
import { Uuid7Generator } from './system.js';

// F2: límite de pujas por postor, cabeceras de seguridad, CORS con lista blanca y sin trazas al cliente.
const TENANT = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-14T12:00:00.000Z');
const DB_URL = 'postgresql://u:p@localhost:5432/d';
const ORIGIN = 'https://app.ejemplo.com';

let db: TestDatabase;
let lotId: string;
const clock = new FixedClock(NOW);

function make(
  env: Record<string, string> = {},
  overrides: { clock?: FixedClock } = {},
): FastifyInstance {
  return buildApp({
    config: loadConfig({ LOG_LEVEL: 'silent', NODE_ENV: 'test', DATABASE_URL: DB_URL, ...env }),
    prisma: db.prisma,
    clock: overrides.clock ?? clock,
    ids: new Uuid7Generator(),
    tenantResolver: { resolve: () => TENANT },
    eventsTopic: 'bidstream.events.lot',
    commandsTopic: 'bidstream.commands.bid',
  });
}

const bid = (app: FastifyInstance, bidder: string, key: string = `clave-${randomUUID()}`) =>
  app.inject({
    method: 'POST',
    url: `/v1/lots/${lotId}/bids`,
    headers: { 'x-bidder-id': bidder, 'idempotency-key': key },
    payload: { amount: '100.00' },
  });

beforeAll(async () => {
  db = await createTestDatabase();
  lotId = randomUUID();
  await db.prisma.lot.create({
    data: {
      id: lotId,
      auctionId: randomUUID(),
      tenantId: TENANT,
      title: 'Lote',
      startingPrice: '100.00',
      minIncrement: '5.00',
      currency: 'USD',
      closesAt: new Date('2026-11-14T13:00:00.000Z'),
      status: 'OPEN',
    },
  });
});

afterAll(async () => {
  await db.drop();
});

describe('límite de pujas por postor y minuto (A04)', () => {
  it('la puja N+1 da 429 con Retry-After; otro postor no se ve afectado', async () => {
    const app = make({ BID_RATE_LIMIT_PER_MINUTE: '3' }, { clock: new FixedClock(NOW) });
    const who = randomUUID();
    const statuses: number[] = [];
    let last: Awaited<ReturnType<typeof bid>> | undefined;
    for (let i = 0; i < 5; i++) {
      last = await bid(app, who);
      statuses.push(last.statusCode);
    }
    expect(statuses).toEqual([202, 202, 202, 429, 429]);
    expect(last?.headers['content-type']).toContain('application/problem+json');
    expect(last?.headers['retry-after']).toBe('60');
    expect(last?.headers['ratelimit-limit']).toBe('3');
    expect(last?.headers['ratelimit-remaining']).toBe('0');
    expect(last?.json()).toMatchObject({
      type: 'urn:bidstream:problem:too-many-requests',
      status: 429,
    });
    expect((await bid(app, randomUUID())).statusCode).toBe(202);
    await app.close();
  });

  it('las pujas rechazadas por el límite no dejan comando ni clave', async () => {
    const app = make({ BID_RATE_LIMIT_PER_MINUTE: '1' }, { clock: new FixedClock(NOW) });
    const who = randomUUID();
    await bid(app, who);
    const key = `clave-${randomUUID()}`;
    expect((await bid(app, who, key)).statusCode).toBe(429);
    expect(await db.prisma.idempotencyKey.count({ where: { bidderId: who, key } })).toBe(0);
    expect(await db.prisma.idempotencyKey.count({ where: { bidderId: who } })).toBe(1);
    await app.close();
  });

  it('pasada la ventana vuelve a poder pujar, y Retry-After refleja lo que falta', async () => {
    const time = new FixedClock(NOW);
    const app = make({ BID_RATE_LIMIT_PER_MINUTE: '2' }, { clock: time });
    const who = randomUUID();
    await bid(app, who);
    time.advance(20_000);
    await bid(app, who);
    time.advance(10_000);
    const blocked = await bid(app, who);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBe('30'); // la más antigua tiene 30 s y caduca a los 60
    time.advance(31_000);
    expect((await bid(app, who)).statusCode).toBe(202);
    await app.close();
  });

  it('repetir una petición idempotente no consume cupo', async () => {
    const app = make({ BID_RATE_LIMIT_PER_MINUTE: '2' }, { clock: new FixedClock(NOW) });
    const who = randomUUID();
    const key = `clave-${randomUUID()}`;
    for (let i = 0; i < 6; i++) expect((await bid(app, who, key)).statusCode).toBe(202);
    expect((await bid(app, who)).statusCode).toBe(202); // sigue teniendo un cupo
    expect((await bid(app, who)).statusCode).toBe(429);
    await app.close();
  });

  it('dos instancias de la API comparten el límite y una ráfaga simultánea no lo supera', async () => {
    const time = new FixedClock(NOW);
    const a = make({ BID_RATE_LIMIT_PER_MINUTE: '5' }, { clock: time });
    const b = make({ BID_RATE_LIMIT_PER_MINUTE: '5' }, { clock: time });
    const who = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => bid(i % 2 === 0 ? a : b, who)),
    );
    const accepted = responses.filter((r) => r.statusCode === 202).length;
    expect(accepted).toBe(5);
    expect(responses.filter((r) => r.statusCode === 429)).toHaveLength(15);
    expect(await db.prisma.idempotencyKey.count({ where: { bidderId: who } })).toBe(5);
    await Promise.all([a.close(), b.close()]);
  });
});

describe('cabeceras de seguridad (A05)', () => {
  it('la API responde con cabeceras seguras y sin X-Powered-By', async () => {
    const app = make();
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cross-origin-resource-policy': 'same-origin',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    });
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toBeUndefined(); // solo en producción
    await app.close();
  });

  it('la documentación no lleva la CSP estricta, para que Swagger UI funcione', async () => {
    const app = make();
    const res = await app.inject({ method: 'GET', url: '/v1/docs/json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toBeUndefined();
    await app.close();
  });

  it('en producción añade HSTS', async () => {
    const keys = generateKeyPairSync('ed25519');
    const authConfig = loadAuthConfig({
      AUTH_JWT_PRIVATE_KEY: Buffer.from(
        keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      ).toString('base64'),
      AUTH_JWT_KEY_ID: 'k1',
    });
    const app = buildApp({
      config: loadConfig({ LOG_LEVEL: 'silent', NODE_ENV: 'production', DATABASE_URL: DB_URL }),
      prisma: db.prisma,
      clock,
      ids: new Uuid7Generator(),
      tenantResolver: new JwtTenantResolver(),
      bidderResolver: new JwtBidderResolver(),
      eventsTopic: 'e',
      commandsTopic: 'c',
      auth: {
        service: new AuthService({ db: db.prisma, config: authConfig }),
        verifier: authConfig.verifier,
      },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.headers['strict-transport-security']).toMatch(/max-age=15552000/);
    // las respuestas de autenticación no se guardan en cachés
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        tenantId: TENANT,
        email: 'nadie@ejemplo.com',
        password: 'una-contraseña-larga-123',
      },
    });
    expect(login.headers['cache-control']).toBe('no-store');
    await app.close();
  });
});

describe('CORS con lista blanca (A05)', () => {
  it('sin CORS_ALLOWED_ORIGINS no se emite ninguna cabecera CORS', async () => {
    const app = make();
    const res = await app.inject({ method: 'GET', url: '/v1/health', headers: { origin: ORIGIN } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('un origen permitido recibe CORS; uno no permitido, no', async () => {
    const app = make({ CORS_ALLOWED_ORIGINS: `${ORIGIN}, https://otra.ejemplo.com` });
    const allowed = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { origin: ORIGIN },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();
    expect(String(allowed.headers['access-control-expose-headers'])).toContain('retry-after');
    for (const origin of [
      'https://malo.ejemplo.com',
      'http://app.ejemplo.com',
      'https://app.ejemplo.com.malo.com',
      'null',
    ]) {
      const res = await app.inject({ method: 'GET', url: '/v1/health', headers: { origin } });
      expect(res.headers['access-control-allow-origin'], origin).toBeUndefined();
    }
    await app.close();
  });

  it('el preflight de un origen permitido se resuelve sin token, incluso en modo jwt', async () => {
    const keys = generateKeyPairSync('ed25519');
    const authConfig = loadAuthConfig({
      AUTH_JWT_PRIVATE_KEY: Buffer.from(
        keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      ).toString('base64'),
      AUTH_JWT_KEY_ID: 'k1',
    });
    const app = buildApp({
      config: loadConfig({
        LOG_LEVEL: 'silent',
        NODE_ENV: 'test',
        AUTH_MODE: 'jwt',
        CORS_ALLOWED_ORIGINS: ORIGIN,
        DATABASE_URL: DB_URL,
      }),
      prisma: db.prisma,
      clock,
      ids: new Uuid7Generator(),
      tenantResolver: new JwtTenantResolver(),
      eventsTopic: 'e',
      commandsTopic: 'c',
      auth: {
        service: new AuthService({ db: db.prisma, config: authConfig }),
        verifier: authConfig.verifier,
      },
    });
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/v1/lots/x/bids',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type,idempotency-key',
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(String(preflight.headers['access-control-allow-headers'])).toContain('idempotency-key');
    // y una petición real sin token sigue siendo 401
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/auctions',
          headers: { origin: ORIGIN },
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    await app.close();
  });

  it('la configuración rechaza `*`, rutas y orígenes mal formados', () => {
    for (const bad of [
      '*',
      'https://*.ejemplo.com',
      'https://app.ejemplo.com/ruta',
      'app.ejemplo.com',
      'javascript:alert(1)',
    ]) {
      expect(() => loadConfig({ DATABASE_URL: DB_URL, CORS_ALLOWED_ORIGINS: bad }), bad).toThrow(
        /CORS_ALLOWED_ORIGINS/,
      );
    }
    expect(
      loadConfig({
        DATABASE_URL: DB_URL,
        CORS_ALLOWED_ORIGINS: 'https://a.com, http://localhost:5173',
      }).CORS_ALLOWED_ORIGINS,
    ).toEqual(['https://a.com', 'http://localhost:5173']);
  });
});

describe('sin trazas ni detalles internos (A05)', () => {
  it('un error interno devuelve problem+json genérico, sin pila ni mensaje', async () => {
    const app = make();
    await app.after();
    app.get('/v1/falla', () => {
      throw new Error('contraseña de la base de datos: hunter2 en /srv/app/secreto.ts:42');
    });
    const res = await app.inject({ method: 'GET', url: '/v1/falla' });
    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).not.toMatch(/hunter2|secreto\.ts|at \w+|stack/i);
    expect(res.json()).toMatchObject({ type: 'urn:bidstream:problem:internal-error', status: 500 });
    await app.close();
  });
});

describe('límite global por IP', () => {
  it('superado responde 429 problem+json con Retry-After; la salud no cuenta', async () => {
    const app = make({ API_RATE_LIMIT_PER_MINUTE: '3' });
    const statuses: number[] = [];
    let last: Awaited<ReturnType<typeof app.inject>> | undefined;
    for (let i = 0; i < 5; i++) {
      last = await app.inject({ method: 'GET', url: '/v1/docs/json' });
      statuses.push(last.statusCode);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(last?.headers['content-type']).toContain('application/problem+json');
    expect(last?.headers['retry-after']).toBeDefined();
    for (let i = 0; i < 10; i++) {
      expect((await app.inject({ method: 'GET', url: '/v1/health' })).statusCode).toBe(200);
    }
    await app.close();
  });
});
