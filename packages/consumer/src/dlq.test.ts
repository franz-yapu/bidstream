import { describe, expect, it } from 'vitest';
import { buildDlqMessage, describeError, dlqMessageSchema } from './dlq.js';

const message = {
  topic: 'bidstream.events.lot',
  partition: 2,
  offset: '41',
  key: 'lot-1',
  value: '{"a":1}',
  headers: {},
};

describe('buildDlqMessage', () => {
  it('cumple dlqMessageSchema y conserva el valor original sin tocar', () => {
    const dlq = buildDlqMessage({
      message,
      consumer: 'projector',
      error: new Error('fallo'),
      attempts: 4,
      reason: 'retries-exhausted',
      now: new Date('2026-11-12T20:00:00.000Z'),
    });
    expect(dlqMessageSchema.safeParse(dlq).success).toBe(true);
    expect(dlq).toMatchObject({
      original: '{"a":1}',
      key: 'lot-1',
      consumer: 'projector',
      attempts: 4,
      source: { topic: 'bidstream.events.lot', partition: 2, offset: '41' },
      failedAt: '2026-11-12T20:00:00.000Z',
    });
  });

  it('no incluye la traza del error', () => {
    const error = new Error('fallo');
    const dlq = buildDlqMessage({
      message,
      consumer: 'c',
      error,
      attempts: 1,
      reason: 'poison',
      now: new Date(),
    });
    expect(JSON.stringify(dlq)).not.toContain('at ');
    expect(Object.keys(dlq.error).sort()).toEqual(['message', 'name']);
  });

  it('rechaza campos desconocidos y razones no previstas', () => {
    const base = buildDlqMessage({
      message,
      consumer: 'c',
      error: 'x',
      attempts: 1,
      reason: 'poison',
      now: new Date(),
    });
    expect(dlqMessageSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(dlqMessageSchema.safeParse({ ...base, reason: 'otra' }).success).toBe(false);
  });
});

describe('describeError', () => {
  it('acepta valores que no son Error y recorta mensajes enormes', () => {
    expect(describeError('texto')).toEqual({ name: 'Error', message: 'texto' });
    expect(describeError(new Error('x'.repeat(5000))).message).toHaveLength(1000);
  });
});
