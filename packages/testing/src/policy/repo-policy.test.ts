import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Barrera contra regresiones de la política de dependencias y de CI (OWASP A06/A08): no prueba el
// servicio de Dependabot, sino que la configuración del repositorio no se degrade sin que se note.
const root = resolve(import.meta.dirname, '../../../..');
const workflowsDir = resolve(root, '.github/workflows');
const workflowFiles = readdirSync(workflowsDir).filter((f) => f.endsWith('.yml'));

const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');
const workflow = (name: string): Record<string, unknown> =>
  parse(readFileSync(resolve(workflowsDir, name), 'utf8')) as Record<string, unknown>;

describe('acciones de GitHub', () => {
  it.each(workflowFiles)('%s: toda acción está fijada por el SHA de un commit', (file) => {
    const uses = readFileSync(resolve(workflowsDir, file), 'utf8')
      .split('\n')
      .filter((line) => /^\s*-?\s*uses:/.test(line));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line, `acción sin SHA en ${file}: ${line.trim()}`).toMatch(
        /uses:\s*[\w./-]+@[0-9a-f]{40}\b/,
      );
    }
  });

  it.each(workflowFiles)('%s: los permisos por defecto son de solo lectura', (file) => {
    const permissions = workflow(file)['permissions'] as Record<string, string> | undefined;
    expect(permissions).toBeDefined();
    expect(Object.values(permissions ?? {}).every((p) => p === 'read')).toBe(true);
  });

  it('ningún flujo usa pull_request_target (ejecutaría código no confiable con permisos)', () => {
    for (const file of workflowFiles) {
      expect(readFileSync(resolve(workflowsDir, file), 'utf8')).not.toContain(
        'pull_request_target',
      );
    }
  });
});

describe('auditoría de dependencias (security.yml)', () => {
  const text = readFileSync(resolve(workflowsDir, 'security.yml'), 'utf8');
  const parsed = workflow('security.yml');

  it('falla ante cualquier aviso en producción y ante alto o crítico en todo', () => {
    expect(text).toContain('npm audit --omit=dev --audit-level=low');
    expect(text).toContain('npm audit --audit-level=high');
  });

  it('verifica las firmas del registro con un npm fijado (no flotante)', () => {
    expect(text).toMatch(/npx --yes npm@\d+\.\d+\.\d+ audit signatures/);
  });

  it('se ejecuta en PR, en main y cada semana (los avisos aparecen sin cambiar el código)', () => {
    const on = parsed['on'] as Record<string, unknown>;
    expect(Object.keys(on)).toEqual(
      expect.arrayContaining(['pull_request', 'push', 'schedule', 'workflow_dispatch']),
    );
    const schedule = on['schedule'] as { cron: string }[];
    expect(schedule[0]?.cron).toMatch(/^\d+ \d+ \* \* 1$/);
  });

  it('no ejecuta scripts de instalación (la auditoría no los necesita)', () => {
    expect(text).toContain('npm ci --ignore-scripts');
  });

  it('el resumen informativo no bloquea', () => {
    expect(text).toMatch(/npm audit \|\| true/);
  });
});

describe('Dependabot', () => {
  const config = parse(read('.github/dependabot.yml')) as {
    version: number;
    updates: {
      'package-ecosystem': string;
      schedule: { interval: string };
      'commit-message': { prefix: string };
      groups?: Record<string, unknown>;
      ignore?: { 'dependency-name': string }[];
      'open-pull-requests-limit': number;
    }[];
  };
  const byEcosystem = (name: string) => config.updates.find((u) => u['package-ecosystem'] === name);

  it('actualiza npm y github-actions cada semana', () => {
    expect(config.version).toBe(2);
    expect(byEcosystem('npm')?.schedule.interval).toBe('weekly');
    expect(byEcosystem('github-actions')?.schedule.interval).toBe('weekly');
  });

  it('agrupa las actualizaciones y limita las PR abiertas', () => {
    expect(Object.keys(byEcosystem('npm')?.groups ?? {}).length).toBeGreaterThanOrEqual(2);
    expect(byEcosystem('github-actions')?.groups).toBeDefined();
    for (const u of config.updates) expect(u['open-pull-requests-limit']).toBeLessThanOrEqual(5);
  });

  it('los mensajes de commit son compatibles con commitlint (conventional commits)', () => {
    for (const u of config.updates)
      expect(u['commit-message'].prefix).toMatch(/^chore\(deps(-dev)?\)$/);
  });

  it.each(['@types/node', 'graphql', 'prisma', '@prisma/*', '@confluentinc/kafka-javascript'])(
    'no sube sola la versión mayor de %s',
    (name) => {
      const ignored = byEcosystem('npm')?.ignore?.map((i) => i['dependency-name']) ?? [];
      expect(ignored).toContain(name);
    },
  );
});

describe('coherencia de versiones', () => {
  it('.nvmrc, engines y la CI apuntan a Node 22', () => {
    const nvmrc = read('.nvmrc').trim();
    const pkg = JSON.parse(read('package.json')) as {
      engines: { node: string };
      overrides?: Record<string, string>;
    };
    expect(nvmrc).toBe('22');
    expect(pkg.engines.node).toBe('>=22');
    expect(readFileSync(resolve(workflowsDir, 'ci.yml'), 'utf8')).toContain(
      'node-version-file: .nvmrc',
    );
  });

  it('el override de minimatch sigue vigente (la versión afectada es < 11.0.1)', () => {
    const pkg = JSON.parse(read('package.json')) as { overrides?: Record<string, string> };
    expect(pkg.overrides?.['minimatch']).toBe('^11.0.8');
    const lock = JSON.parse(read('package-lock.json')) as {
      packages: Record<string, { version?: string }>;
    };
    for (const [path, info] of Object.entries(lock.packages)) {
      if (path.endsWith('node_modules/minimatch')) {
        expect(Number(info.version?.split('.')[0])).toBeGreaterThanOrEqual(11);
      }
    }
  });

  it('los scripts de auditoría locales aplican la misma política que la CI', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['audit:prod']).toContain('--omit=dev');
    expect(pkg.scripts['audit:high']).toContain('--audit-level=high');
  });
});
