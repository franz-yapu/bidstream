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
      TENANT_MODE: 'header',
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

  it('el tenant por cabecera no puede usarse en producción (hasta F1)', () => {
    expect(() => loadConfig({ DATABASE_URL: DB, NODE_ENV: 'production' })).toThrow(/producción/);
  });

  describe('ADMIN_API_KEY', () => {
    it('es opcional: sin ella las rutas de administración no existen', () => {
      expect(loadConfig({ DATABASE_URL: DB })).not.toHaveProperty('ADMIN_API_KEY');
    });
    it('exige al menos 32 caracteres', () => {
      expect(() => loadConfig({ DATABASE_URL: DB, ADMIN_API_KEY: 'corta' })).toThrow(
        /32 caracteres/,
      );
      expect(() => loadConfig({ DATABASE_URL: DB, ADMIN_API_KEY: 'x'.repeat(31) })).toThrow();
      expect(
        loadConfig({ DATABASE_URL: DB, ADMIN_API_KEY: 'x'.repeat(32) }).ADMIN_API_KEY,
      ).toHaveLength(32);
    });
  });
});
