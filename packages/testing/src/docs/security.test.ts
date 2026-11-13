import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SECURITY.md (F5) no puede afirmar lo que no existe: estructura, enlaces, evidencia y dos comprobaciones
// del propio código que sostienen A03 y A10.
const root = resolve(import.meta.dirname, '../../../..');
const security = readFileSync(resolve(root, 'SECURITY.md'), 'utf8');

/** Contenido de la sección `### Axx …` hasta la siguiente. */
function sections(): { id: string; title: string; body: string }[] {
  return [...security.matchAll(/^### (A\d{2}) · (.+?) — _(\w+)_\n([\s\S]*?)(?=^### A\d{2} |^## )/gm)].map((m) => ({
    id: m[1] ?? '',
    title: `${m[2] ?? ''} — ${m[3] ?? ''}`,
    body: m[4] ?? '',
  }));
}

const localLinks = (text: string): string[] =>
  [...text.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1] ?? '')
    .filter((t) => t !== '' && !/^[a-z]+:/.test(t) && !t.startsWith('#'))
    .map((t) => resolve(dirname(resolve(root, 'SECURITY.md')), t.split('#')[0] ?? ''));

/** Archivos `.ts` de la aplicación (sin pruebas, generados, compilados ni dependencias). */
function applicationSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (['node_modules', 'dist', 'generated', 'demo'].includes(name)) return [];
    if (statSync(path).isDirectory()) return applicationSources(path);
    return name.endsWith('.ts') && !/\.(int\.)?test\.ts$/.test(name) ? [path] : [];
  });
}

describe('estructura', () => {
  it('recorre A01…A10 en orden, con un estado válido', () => {
    const found = sections();
    expect(found.map((s) => s.id)).toEqual(Array.from({ length: 10 }, (_, i) => `A${String(i + 1).padStart(2, '0')}`));
    for (const section of found) {
      expect(section.title, section.id).toMatch(/— (Hecho|Parcial|Pendiente)$/);
      expect(section.body, section.id).toContain('**Qué se hizo:**');
    }
  });

  it('todo punto Hecho o Parcial enlaza una prueba y código o un ADR; lo Parcial dice qué falta', () => {
    for (const section of sections()) {
      if (section.title.endsWith('Pendiente')) continue;
      const links = localLinks(section.body).map((l) => relative(root, l));
      expect(links.some((l) => /\.test\.ts$/.test(l)), `${section.id} sin prueba`).toBe(true);
      expect(links.some((l) => !/\.test\.ts$/.test(l)), `${section.id} sin código ni ADR`).toBe(true);
      if (section.title.endsWith('Parcial')) expect(section.body, section.id).toMatch(/\*\*Falta/);
    }
  });

  it('todo enlace relativo existe', () => {
    const links = localLinks(security);
    expect(links.length).toBeGreaterThan(25);
    for (const link of links) expect(existsSync(link), link).toBe(true);
  });

  it('tiene política de reporte, fronteras de confianza y límites conocidos', () => {
    expect(security).toMatch(/^## Reportar una vulnerabilidad$/m);
    expect(security).toMatch(/^## Fronteras de confianza$/m);
    expect(security).toMatch(/^## Límites conocidos y pendientes$/m);
    expect(security).not.toMatch(/@[\w.-]+\.\w{2,}/); // sin correos personales
  });

  it('el README enlaza SECURITY.md y ya no lo da por pendiente', () => {
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
    expect(readme).toContain('(SECURITY.md)');
    expect(readme).not.toMatch(/\*\*`SECURITY\.md`\*\* con el mapeo OWASP\./);
  });
});

describe('lo que el documento afirma del código', () => {
  const sources = [...applicationSources(resolve(root, 'apps')), ...applicationSources(resolve(root, 'packages'))];

  it('hay código que revisar', () => {
    expect(sources.length).toBeGreaterThan(80);
  });

  it('A10: ninguna llamada HTTP saliente en la aplicación', () => {
    const outbound = /(?<![.\w])fetch\(|\baxios\b|\bundici\b|\bgot\(|\bhttps?\.(request|get)\(|\bnode-fetch\b/;
    const offenders = sources.filter((file) => {
      // se ignoran los comentarios de línea y de bloque
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      return outbound.test(code);
    });
    expect(offenders.map((f) => relative(root, f))).toEqual([]);
  });

  it('A03: el SQL crudo solo usa plantillas parametrizadas, nunca *Unsafe', () => {
    const unsafe = sources.filter((file) => /\$(queryRaw|executeRaw)Unsafe/.test(readFileSync(file, 'utf8')));
    expect(unsafe.map((f) => relative(root, f))).toEqual([]);
    const raw = sources.filter((file) => readFileSync(file, 'utf8').includes('$queryRaw'));
    expect(raw.length).toBeGreaterThan(0); // la comprobación mira donde hay SQL crudo
  });
});
