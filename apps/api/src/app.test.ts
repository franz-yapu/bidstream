import { primitives } from '@bidstream/domain';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { API_PREFIX, buildApp } from './app.js';
import { FixedClock, SequentialIdGenerator } from '@bidstream/domain';
import type { PrismaClient } from '@bidstream/db';
import { loadConfig } from './config.js';
import { HeaderTenantResolver } from './tenant.js';

const config = loadConfig({
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
});
// Estas pruebas no tocan la base de datos: cualquier uso del cliente es un error.
const noDb = new Proxy(
  {},
  {
    get: () => {
      throw new Error('esta prueba no debe usar la base de datos');
    },
  },
) as unknown as PrismaClient;
let app: FastifyInstance;

// Rutas solo de prueba: ejercitan validación (con las primitivas del dominio) y el error no controlado.
const testRoutes: FastifyPluginAsyncZod = (instance) => {
  instance.post(
    '/test/bids',
    {
      schema: {
        body: z.strictObject({ lotId: primitives.uuid, amount: primitives.money }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    () => ({ ok: true as const }),
  );
  instance.get('/test/boom', () => {
    throw new Error('detalle interno secreto: password=hunter2');
  });
  return Promise.resolve();
};

function make(): FastifyInstance {
  app = buildApp({
    config,
    prisma: noDb,
    clock: new FixedClock(new Date('2026-11-12T20:00:00.000Z')),
    ids: new SequentialIdGenerator(),
    tenantResolver: new HeaderTenantResolver(),
    eventsTopic: 'bidstream.events.lot',
  });
  void app.register(testRoutes, { prefix: API_PREFIX });
  return app;
}

afterEach(async () => {
  await app.close();
});

describe('health', () => {
  it('GET /v1/health responde 200 con status ok', async () => {
    const res = await make().inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', uptimeSeconds: expect.any(Number) as number });
  });
  it('sin el prefijo /v1 no existe (versionado)', async () => {
    const res = await make().inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(404);
  });
});

describe('documentación', () => {
  it('GET /v1/docs/json devuelve un OpenAPI 3 con /v1/health', async () => {
    const res = await make().inject({ method: 'GET', url: '/v1/docs/json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json<{ openapi: string; paths: Record<string, unknown> }>();
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths)).toContain('/v1/health');
  });
  it('GET /v1/docs/ sirve la interfaz HTML', async () => {
    const res = await make().inject({ method: 'GET', url: '/v1/docs/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });
});

describe('errores (RFC 9457, sin detalles internos)', () => {
  it('404 con problem+json', async () => {
    const res = await make().inject({ method: 'GET', url: '/v1/no-existe' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ status: 404, type: 'urn:bidstream:problem:not-found' });
  });

  it('400 de validación lista los campos inválidos y usa las primitivas del dominio', async () => {
    const res = await make().inject({
      method: 'POST',
      url: '/v1/test/bids',
      payload: { lotId: 'no-es-uuid', amount: '10.505' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ type: string; errors: { path: string; message: string }[] }>();
    expect(body.type).toBe('urn:bidstream:problem:validation-error');
    expect(body.errors.map((e) => e.path).sort()).toEqual(['amount', 'lotId']);
  });

  it('acepta un cuerpo válido', async () => {
    const res = await make().inject({
      method: 'POST',
      url: '/v1/test/bids',
      payload: { lotId: '33333333-3333-4333-8333-333333333333', amount: '10.50' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rechaza campos desconocidos en el cuerpo', async () => {
    const res = await make().inject({
      method: 'POST',
      url: '/v1/test/bids',
      payload: { lotId: '33333333-3333-4333-8333-333333333333', amount: '1', extra: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('JSON mal formado → 400 problem+json', async () => {
    const res = await make().inject({
      method: 'POST',
      url: '/v1/test/bids',
      headers: { 'content-type': 'application/json' },
      payload: '{no es json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('tipo de contenido no soportado → 415', async () => {
    const res = await make().inject({
      method: 'POST',
      url: '/v1/test/bids',
      headers: { 'content-type': 'application/xml' },
      payload: '<a/>',
    });
    expect(res.statusCode).toBe(415);
  });

  it('un error no controlado → 500 genérico, sin mensaje ni traza', async () => {
    const res = await make().inject({ method: 'GET', url: '/v1/test/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const text = res.body;
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('detalle interno');
    expect(text).not.toMatch(/\bat .*\.(ts|js):\d+/);
    expect(res.json()).toMatchObject({ status: 500, title: 'Error interno' });
  });
});

describe('x-request-id', () => {
  it('devuelve el id del cliente si es inofensivo', async () => {
    const res = await make().inject({
      method: 'GET',
      url: '/v1/health',
      headers: { 'x-request-id': 'req-123.abc' },
    });
    expect(res.headers['x-request-id']).toBe('req-123.abc');
  });
  it('genera uno si no llega y lo incluye en los errores', async () => {
    const res = await make().inject({ method: 'GET', url: '/v1/no-existe' });
    const id = res.headers['x-request-id'];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.json<{ requestId: string }>().requestId).toBe(id);
  });
  it('descarta un id con caracteres peligrosos', async () => {
    const res = await make().inject({
      method: 'GET',
      url: '/v1/health',
      headers: { 'x-request-id': 'a b\\"; drop' },
    });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('ciclo de vida', () => {
  it('arranca en un puerto libre y se cierra de forma ordenada', async () => {
    const instance = make();
    await instance.listen({ port: 0, host: '127.0.0.1' });
    const address = instance.server.address();
    expect(address).not.toBeNull();
    await instance.close();
    expect(instance.server.listening).toBe(false);
  });
});
