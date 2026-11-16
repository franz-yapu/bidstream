import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// El mapeo OWASP es documentación de seguridad: esta barrera impide que las filas desaparezcan, que
// los enlaces apunten a archivos que ya no existen o que lo pendiente de Azure se presente como hecho
// (docs/sdd/F5/SDD.md §4).
const root = resolve(import.meta.dirname, '../../../..');
const path = resolve(root, 'SECURITY.md');
const text = readFileSync(path, 'utf8');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
const OWASP = ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10'] as const;

/** Destinos de los enlaces markdown relativos (sin ancla ni URL externas). */
function localLinks(body: string, from: string): string[] {
  return [...body.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1] ?? '')
    .filter((t) => t !== '' && !/^[a-z]+:/.test(t) && !t.startsWith('#'))
    .map((t) => resolve(dirname(from), t.split('#')[0] ?? ''));
}

/** Cuerpo de cada sección `## Axx · título` hasta el siguiente `## `. */
function sections(): Map<string, string> {
  const result = new Map<string, string>();
  const parts = text.split(/^## /m).slice(1);
  for (const part of parts) {
    const id = /^(A\d\d) · /.exec(part)?.[1];
    if (id !== undefined) result.set(id, part);
  }
  return result;
}

const body = sections();

describe('estructura (spec §8)', () => {
  it('tiene las diez secciones A01–A10, en orden', () => {
    expect([...body.keys()]).toEqual([...OWASP]);
  });

  it('el índice lista los diez puntos con un estado válido', () => {
    const index = text.split(/^## Índice$/m)[1]?.split(/^---$/m)[0] ?? '';
    for (const id of OWASP) {
      expect(index, id).toMatch(new RegExp(`\\| \\[${id}\\]\\(#`));
    }
    const states = [...index.matchAll(/\|\s*(✅|🟡|⛔)\s*\|/g)].map((m) => m[1]);
    expect(states).toHaveLength(OWASP.length);
  });

  it('cada sección declara un estado válido', () => {
    for (const id of OWASP) {
      expect(body.get(id), id).toMatch(/^\*\*Estado:\*\* (✅|🟡|⛔)/m);
    }
  });
});

describe('evidencia', () => {
  it('cada punto cita al menos un archivo que existe en el repo', () => {
    for (const id of OWASP) {
      const links = localLinks(body.get(id) ?? '', path);
      expect(links.length, id).toBeGreaterThan(0);
      for (const target of links) expect(existsSync(target), `${id}: ${target}`).toBe(true);
    }
  });

  it('todo enlace relativo del documento apunta a algo que existe', () => {
    const links = localLinks(text, path);
    expect(links.length).toBeGreaterThan(10);
    for (const target of links) expect(existsSync(target), target).toBe(true);
  });
});

describe('honestidad', () => {
  it('lo pendiente de Azure y de observabilidad está marcado y nombra su bloqueo', () => {
    expect(body.get('A02')).toMatch(/\*\*Estado:\*\* 🟡/);
    expect(body.get('A02')).toMatch(/H1/);
    expect(body.get('A09')).toMatch(/\*\*Estado:\*\* 🟡/);
    expect(body.get('A09')).toMatch(/H4/);
  });

  it('TLS, Key Vault y las alertas no se presentan como hechos', () => {
    const a02 = body.get('A02') ?? '';
    expect(a02).toMatch(/TLS/);
    expect(a02).toMatch(/Key Vault/);
    expect(a02).not.toMatch(/TLS (está|ya está) implementado/i);
    expect(body.get('A09') ?? '').not.toMatch(/alertas (están|ya están) implementadas/i);
  });

  it('no contiene claves privadas, hashes de contraseña ni secretos con valor', () => {
    expect(text).not.toContain('-----BEGIN');
    expect(text).not.toMatch(/\$argon2/);
    expect(text).not.toMatch(/(PRIVATE_KEY|SECRET|PASSWORD)=\S+/);
  });

  it('el README lo enlaza y ya no lo lista como pendiente', () => {
    expect(readme).toContain('](SECURITY.md)');
    expect(readme).not.toMatch(/\*\*`SECURITY\.md`\*\*/);
  });
});
