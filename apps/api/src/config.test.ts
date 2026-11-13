import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const DB = 'postgresql://u:p@localhost:5432/d';

describe('loadConfig', () => {
  it('aplica los valores por defecto', () => {
    expect(loadConfig({ DATABASE_URL: DB })).toEqual({
      PORT: 3000,
      HOST: '0.0.0.0',
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      DATABASE_URL: DB,
      AUTH_MODE: 'header',
      AUTH_RATE_LIMIT_PER_MINUTE: 20,
      BID_RATE_LIMIT_PER_MINUTE: 30,
      API_RATE_LIMIT_PER_MINUTE: 600,
      CORS_ALLOWED_ORIGINS: [],
    });
  });
  it('lee y convierte valores del entorno', () => {
    expect(
      loadConfig({ DATABASE_URL: DB, PORT: '8080', NODE_ENV: 'test', LOG_LEVEL: 'warn' }),
    ).toMatchObject({
      PORT: 8080,
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
    });
  });
  it.each([{ PORT: 'abc' }, { PORT: '70000' }, { NODE_ENV: 'staging' }, { LOG_LEVEL: 'ruidoso' }])(
    'falla con un entorno inválido %j',
    (env) => {
      expect(() => loadConfig({ DATABASE_URL: DB, ...env })).toThrow();
    },
  );

  it('exige DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow();
  });

  describe('AUTH_MODE (F1)', () => {
    it('por defecto es header fuera de producción y jwt en producción', () => {
      expect(loadConfig({ DATABASE_URL: DB, NODE_ENV: 'test' }).AUTH_MODE).toBe('header');
      expect(loadConfig({ DATABASE_URL: DB, NODE_ENV: 'production' }).AUTH_MODE).toBe('jwt');
    });
    it('las cabeceras de identidad no pueden usarse en producción', () => {
      expect(() =>
        loadConfig({ DATABASE_URL: DB, NODE_ENV: 'production', AUTH_MODE: 'header' }),
      ).toThrow(/producción/);
      expect(loadConfig({ DATABASE_URL: DB, AUTH_MODE: 'jwt' }).AUTH_MODE).toBe('jwt');
    });
    it('rechaza un modo desconocido', () => {
      expect(() => loadConfig({ DATABASE_URL: DB, AUTH_MODE: 'basic' })).toThrow();
    });
  });

  describe('administrador inicial', () => {
    const bootstrap = {
      BOOTSTRAP_ADMIN_TENANT_ID: '11111111-1111-4111-8111-111111111111',
      BOOTSTRAP_ADMIN_EMAIL: 'admin@ejemplo.com',
      BOOTSTRAP_ADMIN_PASSWORD: 'una-contraseña-larga-123',
    };
    it('es opcional, pero los tres valores van juntos', () => {
      expect(loadConfig({ DATABASE_URL: DB })).not.toHaveProperty('BOOTSTRAP_ADMIN_EMAIL');
      expect(loadConfig({ DATABASE_URL: DB, ...bootstrap }).BOOTSTRAP_ADMIN_EMAIL).toBe(
        'admin@ejemplo.com',
      );
      expect(() =>
        loadConfig({ DATABASE_URL: DB, BOOTSTRAP_ADMIN_EMAIL: 'admin@ejemplo.com' }),
      ).toThrow(/van juntos/);
    });
    it('exige tenant UUID, correo válido y contraseña de 12 a 128 caracteres', () => {
      expect(() =>
        loadConfig({ DATABASE_URL: DB, ...bootstrap, BOOTSTRAP_ADMIN_TENANT_ID: 'x' }),
      ).toThrow();
      expect(() =>
        loadConfig({ DATABASE_URL: DB, ...bootstrap, BOOTSTRAP_ADMIN_EMAIL: 'no-es-correo' }),
      ).toThrow();
      expect(() =>
        loadConfig({ DATABASE_URL: DB, ...bootstrap, BOOTSTRAP_ADMIN_PASSWORD: 'corta' }),
      ).toThrow();
    });
  });

  it('ADMIN_API_KEY ya no existe: la administración se hace con el rol ADMIN (F1)', () => {
    expect(loadConfig({ DATABASE_URL: DB, ADMIN_API_KEY: 'x'.repeat(40) })).not.toHaveProperty(
      'ADMIN_API_KEY',
    );
  });
});
