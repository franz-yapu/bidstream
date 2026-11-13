import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Barrera de documentación: no juzga el razonamiento de los ADR, solo que su estructura, sus
// enlaces y su evidencia no se rompan sin que se note.
const root = resolve(import.meta.dirname, '../../../..');
const adrDir = resolve(root, 'docs/adr');
const files = readdirSync(adrDir)
  .filter((f) => /^\d{4}-.+\.md$/.test(f) && !f.startsWith('0000-'))
  .sort();
const read = (path: string): string => readFileSync(path, 'utf8');
const SECTIONS = [
  'Contexto',
  'Decisión',
  'Alternativas descartadas',
  'Consecuencias',
  'Verificación',
] as const;

/** Destinos de los enlaces markdown relativos (sin ancla ni URL externas). */
function localLinks(text: string, from: string): string[] {
  return [...text.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1] ?? '')
    .filter((t) => t !== '' && !/^[a-z]+:/.test(t) && !t.startsWith('#'))
    .map((t) => resolve(dirname(from), t.split('#')[0] ?? ''));
}

describe('numeración', () => {
  it('es contigua desde 0001 y los nombres son NNNN-slug.md', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
    files.forEach((f, i) => {
      expect(f.slice(0, 4)).toBe(String(i + 1).padStart(4, '0'));
      expect(f).toMatch(/^\d{4}-[a-z0-9-]+\.md$/);
    });
  });
});

describe.each(files)('%s', (file) => {
  const path = resolve(adrDir, file);
  const text = read(path);

  it('tiene título con su número y las secciones obligatorias', () => {
    expect(text.split('\n')[0]).toMatch(new RegExp(`^# ${file.slice(0, 4)} — .+`));
    for (const section of SECTIONS) expect(text, section).toMatch(new RegExp(`^## ${section}$`, 'm'));
  });

  it('tiene un estado válido y una fecha ISO', () => {
    const state = /^\*\*Estado:\*\* (.+)$/m.exec(text)?.[1] ?? '';
    expect(state).toMatch(/^(Propuesta|Aceptada|Reemplazada por \d{4})/);
    const replaced = /^Reemplazada por (\d{4})/.exec(state)?.[1];
    if (replaced !== undefined) {
      expect(files.some((f) => f.startsWith(replaced))).toBe(true);
    }
    expect(text).toMatch(/^\*\*Fecha:\*\* \d{4}-\d{2}-\d{2}/m);
  });

  it('todos sus enlaces relativos apuntan a archivos que existen', () => {
    const links = localLinks(text, path);
    expect(links.length).toBeGreaterThan(0);
    for (const target of links) expect(existsSync(target), target).toBe(true);
  });

  it('la Verificación cita al menos un SDD o la spec, y alguna prueba o código', () => {
    const verification = text.split(/^## Verificación$/m)[1] ?? '';
    const links = localLinks(verification, path).map((l) => l.replace(`${root}/`, ''));
    expect(links.some((l) => l.startsWith('docs/sdd/') || l.startsWith('docs/product/'))).toBe(
      true,
    );
    expect(links.some((l) => /\.ts$/.test(l) || l.startsWith('docs/decisions/'))).toBe(true);
  });
});

describe('índice y protección', () => {
  const index = read(resolve(adrDir, 'README.md'));

  it('el índice lista todos los ADR y ninguno inexistente', () => {
    const listed = [...index.matchAll(/\]\((\d{4}-[^)]+\.md)\)/g)].map((m) => m[1]);
    expect(new Set(listed.filter((f) => !f?.startsWith('0000-')))).toEqual(new Set(files));
    for (const f of files) {
      const state = /^\*\*Estado:\*\* (\S+)/m.exec(read(resolve(adrDir, f)))?.[1] ?? '';
      expect(index, f).toContain(state);
    }
  });

  it('do-not-touch enlaza a ADR que existen para cada subsistema protegido', () => {
    const path = resolve(root, 'docs/do-not-touch.md');
    const rows = read(path)
      .split('\n')
      .filter((l) => l.startsWith('|') && !l.includes('---') && !l.includes('Subsistema'));
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const linked = rows.filter((row) => /\(adr\/\d{4}-/.test(row));
    // el dominio hexagonal se protege por una regla de ESLint, no por un ADR numerado
    expect(linked.length).toBeGreaterThanOrEqual(rows.length - 1);
    for (const target of localLinks(read(path), path)) expect(existsSync(target), target).toBe(true);
  });
});
