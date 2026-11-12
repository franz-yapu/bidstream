import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('aplica los valores por defecto', () => {
    expect(loadConfig({})).toEqual({
      PORT: 3000,
      HOST: '0.0.0.0',
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
    });
  });
  it('lee y convierte valores del entorno', () => {
    expect(loadConfig({ PORT: '8080', NODE_ENV: 'production', LOG_LEVEL: 'warn' })).toMatchObject({
      PORT: 8080,
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
    });
  });
  it.each([{ PORT: 'abc' }, { PORT: '70000' }, { NODE_ENV: 'staging' }, { LOG_LEVEL: 'ruidoso' }])(
    'falla con un entorno inválido %j',
    (env) => {
      expect(() => loadConfig(env)).toThrow();
    },
  );
});
