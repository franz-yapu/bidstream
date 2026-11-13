import { createPrismaClient } from '@bidstream/db';
import { createTestDatabase, type TestDatabase } from '@bidstream/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { buildYoga } from './server.js';

// F2: cabeceras de seguridad y CORS con lista blanca en GraphQL.
const DB_URL = 'postgresql://u:p@localhost:5432/d';
const TENANT = '11111111-1111-4111-8111-111111111111';
const ORIGIN = 'https://app.ejemplo.com';

let db: TestDatabase;
let prisma: ReturnType<typeof createPrismaClient>;

beforeAll(async () => {
  db = await createTestDatabase();
  prisma = createPrismaClient(db.url);
});
afterAll(async () => {
  await prisma.$disconnect();
  await db.drop();
});

const yogaWith = (env: Record<string, string> = {}) =>
  buildYoga({
    config: loadConfig({ LOG_LEVEL: 'silent', NODE_ENV: 'test', DATABASE_URL: DB_URL, ...env }),
    db: prisma,
  });

const post = (yoga: ReturnType<typeof yogaWith>, headers: Record<string, string> = {}) =>
  yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tenant-id': TENANT, ...headers },
    body: JSON.stringify({ query: '{ __typename }' }),
  });

describe('cabeceras de seguridad (A05)', () => {
  it('toda respuesta lleva las cabeceras seguras; las de error también', async () => {
    const yoga = yogaWith();
    for (const response of [
      await post(yoga),
      await post(yoga, { 'x-tenant-id': 'no-es-uuid' }),
      await yoga.fetch('http://localhost/graphql?query=%7B__typename%7D', {
        headers: { 'x-tenant-id': TENANT },
      }),
    ]) {
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-security-policy')).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
      expect(response.headers.get('x-powered-by')).toBeNull();
    }
  });

  it('HSTS solo en producción; en desarrollo no hay CSP estricta (GraphiQL)', async () => {
    expect((await post(yogaWith())).headers.get('strict-transport-security')).toBeNull();
    const prod = yogaWith({ NODE_ENV: 'production', AUTH_MODE: 'jwt' });
    const production = await prod.fetch('http://localhost/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
    });
    expect(production.headers.get('strict-transport-security')).toMatch(/max-age=15552000/);
    const dev = await post(yogaWith({ NODE_ENV: 'development' }));
    expect(dev.headers.get('content-security-policy')).toBeNull();
  });
});

describe('CORS con lista blanca (A05)', () => {
  it('sin CORS_ALLOWED_ORIGINS no hay cabeceras CORS, ni siquiera en el preflight', async () => {
    const yoga = yogaWith();
    const res = await post(yoga, { origin: ORIGIN });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await yoga.fetch('http://localhost/graphql', {
      method: 'OPTIONS',
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('un origen de la lista recibe CORS; los demás, no', async () => {
    const yoga = yogaWith({ CORS_ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173` });
    const allowed = await post(yoga, { origin: ORIGIN });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(allowed.headers.get('access-control-allow-credentials')).toBeNull();
    for (const origin of ['https://malo.ejemplo.com', 'https://app.ejemplo.com.malo.com', 'null']) {
      const res = await post(yoga, { origin });
      expect(res.headers.get('access-control-allow-origin'), origin).not.toBe(origin);
      expect(res.headers.get('access-control-allow-origin'), origin).not.toBe('*');
    }
  });

  it('el preflight permite Authorization y se resuelve sin token', async () => {
    const yoga = yogaWith({ CORS_ALLOWED_ORIGINS: ORIGIN });
    const preflight = await yoga.fetch('http://localhost/graphql', {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(preflight.status).toBeLessThan(300);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect((preflight.headers.get('access-control-allow-headers') ?? '').toLowerCase()).toContain(
      'authorization',
    );
  });

  it('la configuración rechaza `*` y orígenes mal formados', () => {
    for (const bad of [
      '*',
      'https://*.ejemplo.com',
      'https://app.ejemplo.com/ruta',
      'app.ejemplo.com',
    ]) {
      expect(() => loadConfig({ DATABASE_URL: DB_URL, CORS_ALLOWED_ORIGINS: bad }), bad).toThrow(
        /CORS_ALLOWED_ORIGINS/,
      );
    }
  });
});
