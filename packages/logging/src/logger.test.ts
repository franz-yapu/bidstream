import { describe, expect, it } from 'vitest';
import { createLogger, levelFromEnv, REDACTED } from './index.js';

const NOW = new Date('2026-11-13T12:00:00.000Z');

function setup(level?: 'debug' | 'info' | 'warn' | 'error') {
  const lines: string[] = [];
  const logger = createLogger({
    service: 'prueba',
    ...(level ? { level } : {}),
    write: (l) => lines.push(l),
    now: () => NOW,
  });
  const parsed = (): Record<string, unknown>[] =>
    lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  return { logger, lines, parsed };
}

describe('formato', () => {
  it('escribe una línea JSON por evento con level, time, service y msg', () => {
    const { logger, lines, parsed } = setup();
    logger.info({ eventId: 'e1' }, 'hola');
    logger.warn({}, 'ojo');
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => !l.includes('\n'))).toBe(true);
    expect(parsed()[0]).toEqual({
      eventId: 'e1',
      level: 'info',
      time: '2026-11-13T12:00:00.000Z',
      service: 'prueba',
      msg: 'hola',
    });
  });

  it('el contexto no puede pisar los campos reservados', () => {
    const { logger, parsed } = setup();
    logger.info({ level: 'fatal', service: 'otro', msg: 'x', time: 'ayer' }, 'real');
    expect(parsed()[0]).toMatchObject({ level: 'info', service: 'prueba', msg: 'real' });
    expect(parsed()[0]?.['time']).toBe('2026-11-13T12:00:00.000Z');
  });

  it('respeta el nivel', () => {
    const { logger, lines } = setup('warn');
    logger.debug({}, 'a');
    logger.info({}, 'b');
    logger.warn({}, 'c');
    logger.error({}, 'd');
    expect(lines).toHaveLength(2);
  });

  it('levelFromEnv cae a info con un valor desconocido', () => {
    expect(levelFromEnv('debug')).toBe('debug');
    expect(levelFromEnv('ruidoso')).toBe('info');
    expect(levelFromEnv(undefined)).toBe('info');
  });
});

describe('child', () => {
  it('conserva el contexto y no muta al padre', () => {
    const { logger, parsed } = setup();
    const child = logger.child({ correlationId: 'c-1' });
    child.info({ a: 1 }, 'hijo');
    logger.info({}, 'padre');
    expect(parsed()[0]).toMatchObject({ correlationId: 'c-1', a: 1 });
    expect(parsed()[1]).not.toHaveProperty('correlationId');
  });
});

describe('errores', () => {
  it('sin pila en info y warn; con pila solo en error', () => {
    const { logger, parsed } = setup();
    const err = new Error('falló');
    logger.warn({ err }, 'w');
    logger.error({ err }, 'e');
    expect(parsed()[0]?.['error']).toEqual({ name: 'Error', message: 'falló' });
    expect(parsed()[1]?.['error']).toHaveProperty('stack');
  });

  it('un error que no es Error se serializa sin reventar', () => {
    const { logger, parsed } = setup();
    logger.error({ err: { codigo: 7 } }, 'raro');
    expect(parsed()[0]?.['error']).toEqual({ message: '{"codigo":7}' });
  });
});

describe('redacción (OWASP A09)', () => {
  it.each([
    'password',
    'token',
    'authorization',
    'x-admin-key',
    'apiKey',
    'API_KEY',
    'DATABASE_URL',
    'connectionString',
    'cookie',
    'clientSecret',
  ])('el valor de %s sale redactado, también anidado y en arrays', (key) => {
    const { logger, lines } = setup();
    logger.info(
      { [key]: 'SECRETO-1', nivel: { [key]: 'SECRETO-2' }, lista: [{ [key]: 'SECRETO-3' }] },
      'x',
    );
    expect(lines[0]).not.toContain('SECRETO');
    expect(lines[0]).toContain(REDACTED);
  });

  it('enmascara la contraseña de una URL en un mensaje, un campo o un error', () => {
    const { logger, lines } = setup();
    logger.error(
      {
        url: 'postgresql://app:Sup3rClave@db:5432/x',
        err: new Error('conexión a postgresql://app:Sup3rClave@db falló'),
      },
      'no conecta',
    );
    expect(lines[0]).not.toContain('Sup3rClave');
    expect(lines[0]).toContain('postgresql://app:[REDACTED]@db');
  });

  it('no revienta con referencias circulares ni con objetos muy profundos', () => {
    const { logger, lines } = setup();
    const circular: Record<string, unknown> = { a: 1 };
    circular['self'] = circular;
    let deep: Record<string, unknown> = { fin: true };
    for (let i = 0; i < 20; i++) deep = { n: deep };
    logger.info({ circular, deep }, 'x');
    expect(lines[0]).toContain('[CIRCULAR]');
    expect(lines[0]).toContain('[TRUNCATED]');
  });

  it('no altera el objeto original', () => {
    const { logger } = setup();
    const fields = { password: 'p', otro: 1 };
    logger.info(fields, 'x');
    expect(fields).toEqual({ password: 'p', otro: 1 });
  });
});
