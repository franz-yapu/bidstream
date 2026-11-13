import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// El guion del vídeo (H5) solo puede citar comandos que existan.
const root = resolve(import.meta.dirname, '../../../..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');
const guion = read('docs/demo/GUION.md');
const makefile = read('Makefile');
const rootScripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;

describe('guion del vídeo del reproceso', () => {
  it('cada `make <objetivo>` existe en el Makefile', () => {
    const targets = [...guion.matchAll(/\bmake ([a-z][\w-]*)/g)].map((m) => m[1] ?? '');
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(makefile, target).toMatch(new RegExp(`^${target}:`, 'm'));
  });

  it('cada script citado existe y es ejecutable en la demostración', () => {
    const scripts = [...guion.matchAll(/\bscripts\/[\w./-]+\.sh/g)].map((m) => m[0]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(existsSync(resolve(root, script)), script).toBe(true);
  });

  it('cada `npm run` del guion existe como script del paquete citado', () => {
    for (const match of guion.matchAll(/npm run ([\w:-]+)(?: -w (@[\w/-]+))?/g)) {
      const [, name = '', workspace] = match;
      if (workspace === undefined) {
        expect(rootScripts, name).toHaveProperty(name);
      } else {
        const dir = workspace === '@bidstream/projector' ? 'apps/projector' : '';
        expect(dir, `workspace ${workspace}`).not.toBe('');
        const pkg = JSON.parse(read(`${dir}/package.json`)) as { scripts: Record<string, string> };
        expect(pkg.scripts, name).toHaveProperty(name);
      }
    }
  });

  it('el guion incluye las tres escenas de la demostración y la verificación', () => {
    for (const text of ['1/3', '2/3', '3/3', 'IDÉNTICO', 'earliest']) expect(guion).toContain(text);
  });
});
