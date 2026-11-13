import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// El README es lo primero que lee un entrevistador: estas pruebas impiden que prometa lo que no hay,
// que quede con enlaces rotos o que cite comandos inexistentes (docs/sdd/I1/SDD.md §4).
const root = resolve(import.meta.dirname, '../../../..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');
const readme = read('README.md');
const makefile = read('Makefile');
const rootScripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;

/** Texto de una sección `## título` hasta la siguiente `## `. */
const section = (title: string): string => {
  const start = readme.indexOf(`\n## ${title}`);
  expect(start, `falta la sección «${title}»`).toBeGreaterThanOrEqual(0);
  const rest = readme.slice(start + 1);
  const end = rest.slice(3).search(/\n## /);
  return end < 0 ? rest : rest.slice(0, end + 3);
};

describe('estructura (spec §12)', () => {
  it('tiene, en orden, las secciones que pide la especificación', () => {
    const titles = [...readme.matchAll(/^## (.+)$/gm)].map((m) => m[1] ?? '');
    const expected = [
      'Qué es',
      'Cómo funciona',
      'Qué cambió respecto a la versión con WebSockets y bloqueos en base de datos',
      'Decisiones de diseño',
      'Reproceso: el log es la fuente de verdad',
      'Stack y puesta en marcha',
      'Estado y límites',
    ];
    expect(titles).toEqual(expected);
  });

  it('«qué cambió» tiene qué ganas, qué pierdes y cuándo elegir cada una', () => {
    const body = section('Qué cambió respecto a la versión con WebSockets y bloqueos en base de datos');
    for (const heading of ['### Qué ganas', '### Qué pierdes', '### Cuándo elegiría cada una']) {
      expect(body).toContain(heading);
    }
    expect(body).toMatch(/\|\s*Aspecto\s*\|/);
  });

  it('el diagrama del flujo nombra los componentes reales', () => {
    const mermaid = /```mermaid\n([\s\S]*?)```/.exec(readme)?.[1] ?? '';
    for (const part of ['outbox', 'relay', 'projector', 'notifier', 'auditor', 'GraphQL', 'DLQ', 'Kafka']) {
      expect(mermaid, part).toContain(part);
    }
  });

  it('el vídeo del reproceso está enlazado o marcado explícitamente como pendiente', () => {
    const body = section('Reproceso: el log es la fuente de verdad');
    const linked = /\*\*Vídeo:\*\*\s*\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(body);
    const pending = body.includes('<!-- VIDEO-PENDIENTE -->') && /Vídeo:\*\* pendiente/.test(body);
    expect(linked || pending).toBe(true);
    expect(linked && pending).toBe(false);
  });
});

describe('enlaces y comandos', () => {
  it('todo enlace relativo apunta a algo que existe', () => {
    const targets = [...readme.matchAll(/\]\(([^)\s]+)\)/g)]
      .map((m) => m[1] ?? '')
      .filter((t) => t !== '' && !/^[a-z]+:/.test(t) && !t.startsWith('#'))
      .map((t) => resolve(root, t.split('#')[0] ?? ''));
    expect(targets.length).toBeGreaterThan(10);
    for (const target of targets) expect(existsSync(target), target).toBe(true);
  });

  it('enlaza todos los ADR y la guía de desarrollo', () => {
    const adrs = readdirSync(resolve(root, 'docs/adr')).filter(
      (f) => /^\d{4}-/.test(f) && !f.startsWith('0000-'),
    );
    for (const adr of adrs) expect(readme, adr).toContain(`docs/adr/${adr}`);
    expect(readme).toContain('docs/DESARROLLO.md');
    expect(existsSync(resolve(root, 'docs/DESARROLLO.md'))).toBe(true);
  });

  it('cada comando de los bloques de código existe', () => {
    const blocks = [...readme.matchAll(/```(?:bash|sh)\n([\s\S]*?)```/g)].map((m) => m[1] ?? '');
    const commands = blocks.join('\n');
    const makeTargets = [...commands.matchAll(/\bmake ([a-z][\w-]*)/g)].map((m) => m[1] ?? '');
    expect(makeTargets).toEqual(expect.arrayContaining(['demo', 'demo-reprocess', 'demo-down']));
    for (const target of makeTargets) expect(makefile, target).toMatch(new RegExp(`^${target}:`, 'm'));
    for (const [, name = ''] of commands.matchAll(/\bnpm run ([\w:-]+)/g)) {
      expect(rootScripts, name).toHaveProperty(name);
    }
    for (const [script = ''] of commands.matchAll(/\bscripts\/[\w./-]+\.sh/g)) {
      expect(existsSync(resolve(root, script)), script).toBe(true);
    }
  });
});

describe('honestidad', () => {
  it('describe la puja como implementada y lo pendiente solo en «Estado y límites»', () => {
    const state = section('Estado y límites');
    expect(state).toMatch(/\*\*no\*\* está/i);
    expect(readme).toContain('POST /v1/lots/:id/bids');
    expect(readme).toContain('docs/adr/0011-decisor-unico-por-lote.md');
    // lo que sigue pendiente está en «Estado y límites» y no se presenta como hecho en otra parte
    for (const pending of ['Límite de pujas', 'Despliegue en Azure']) {
      expect(state, pending).toContain(pending);
    }
    expect(state).not.toMatch(/pendiente de una decisión/);
  });

  it('no afirma cifras de rendimiento sin medir', () => {
    expect(readme).not.toMatch(/\b\d+\s*(x|veces)\s+(más\s+)?(rápid|veloz)/i);
    expect(readme).not.toMatch(/\b\d[\d.,]*\s*(req|peticiones|pujas)\s*\/\s*s/i);
  });

  it('reconoce lo que pierde frente a la versión anterior', () => {
    expect(readme).toMatch(/Funciones de producto/);
    expect(readme).toMatch(/Simplicidad/);
  });
});
