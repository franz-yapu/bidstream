import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const DB = 'postgresql://u:p@localhost:5432/d';

describe('loadConfig', () => {
  it('aplica los valores por defecto', () => {
    expect(loadConfig({ DATABASE_URL: DB })).toMatchObject({
      GRAPHQL_PORT: 4000,
      HOST: '0.0.0.0',
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      DATABASE_URL: DB,
      AUTH_MODE: 'header',
      GQL_MAX_PAGE_SIZE: 100,
    });
  });
  it('lee valores del entorno', () => {
    expect(
      loadConfig({
        DATABASE_URL: DB,
        GRAPHQL_PORT: '5000',
        NODE_ENV: 'test',
        GQL_MAX_PAGE_SIZE: '50',
      }),
    ).toMatchObject({ GRAPHQL_PORT: 5000, NODE_ENV: 'test', GQL_MAX_PAGE_SIZE: 50 });
  });
  it.each([
    { GRAPHQL_PORT: 'abc' },
    { NODE_ENV: 'staging' },
    { GQL_MAX_PAGE_SIZE: '0' },
    { GQL_MAX_PAGE_SIZE: 'x' },
  ])('falla con un entorno inválido %j', (env) => {
    expect(() => loadConfig({ DATABASE_URL: DB, ...env })).toThrow();
  });
  it('exige DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow();
  });
  it('AUTH_MODE: header fuera de producción, jwt en producción, y header prohibido allí (F1)', () => {
    expect(loadConfig({ DATABASE_URL: DB }).AUTH_MODE).toBe('header');
    expect(loadConfig({ DATABASE_URL: DB, NODE_ENV: 'production' }).AUTH_MODE).toBe('jwt');
    expect(() =>
      loadConfig({ DATABASE_URL: DB, NODE_ENV: 'production', AUTH_MODE: 'header' }),
    ).toThrow(/producción/);
  });
});
