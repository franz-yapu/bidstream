import { describe, expect, it } from 'vitest';
import { ServerClock } from './clock';

describe('ServerClock', () => {
  it('calcula el desfase con la cabecera Date y la ignora si falta o no es válida', () => {
    const clock = new ServerClock();
    const at = Date.parse('2030-01-01T10:00:00.000Z');
    clock.observe(new Response('', { headers: { date: 'Tue, 01 Jan 2030 10:00:05 GMT' } }), at);
    expect(clock.offsetMs).toBe(5000);
    clock.observe(new Response(''), at);
    clock.observe(new Response('', { headers: { date: 'basura' } }), at);
    expect(clock.offsetMs).toBe(5000);
  });
});
