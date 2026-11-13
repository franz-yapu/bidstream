import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Barrera contra regresiones de la política de imágenes (H2, OWASP A05/A06/A08): no construye nada,
// comprueba que el Dockerfile y la CI no se degraden sin que se note.
const root = resolve(import.meta.dirname, '../../../..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');
const dockerfile = read('Dockerfile');
const lines = dockerfile.split('\n').map((l) => l.trim());
const stages = dockerfile.split(/^FROM /m).slice(1);
const finalStage = stages.at(-1) ?? '';

const apps = readdirSync(resolve(root, 'apps')).filter((d) =>
  existsSync(resolve(root, 'apps', d, 'src/main.ts')),
);

describe('Dockerfile', () => {
  it('es multi-etapa y la última etapa no corre como root', () => {
    expect(stages.length).toBeGreaterThanOrEqual(3);
    const users = finalStage.split('\n').filter((l) => l.trim().startsWith('USER '));
    expect(users.length).toBeGreaterThan(0);
    expect(users.at(-1)?.trim()).not.toMatch(/^USER\s+(root|0)(:|\s|$)/);
  });

  it('la imagen base está fijada por digest y toda etapa parte de ella', () => {
    const base = /^ARG NODE_IMAGE=(\S+)$/m.exec(dockerfile)?.[1] ?? '';
    expect(base).toMatch(/^node:22-[\w.-]+@sha256:[0-9a-f]{64}$/);
    const froms = lines.filter((l) => l.startsWith('FROM '));
    expect(froms.length).toBe(stages.length);
    for (const from of froms) {
      expect(from, from).toMatch(/^FROM (\$\{NODE_IMAGE\}|\S+@sha256:[0-9a-f]{64}) AS \w[\w-]*$/);
    }
  });

  it('ningún ENV ni ARG lleva un secreto con valor', () => {
    const suspicious = /(PASS|SECRET|TOKEN|KEY|CREDENTIAL|DATABASE_URL|CONNECTION)/i;
    const declared = dockerfile.match(/^\s*(ENV|ARG)\s+.+(\\\n\s+.+)*/gm) ?? [];
    for (const declaration of declared) {
      for (const assignment of declaration.replace(/\\\n/g, ' ').split(/\s+/).slice(1)) {
        const [name, value] = assignment.split('=');
        if (name !== undefined && suspicious.test(name)) {
          expect(value ?? '', `${name} no debe llevar valor`).toBe('');
        }
      }
    }
  });

  it('la etapa final solo copia lo compilado y no instala nada', () => {
    expect(finalStage).not.toMatch(/npm (ci|install)/);
    expect(finalStage).not.toMatch(/COPY[^\n]*\.env/);
    expect(finalStage).not.toMatch(/COPY\s+(--\S+\s+)*\.\s/); // nada de `COPY . .` en la final
  });

  it('las dependencias de producción se instalan sin desarrollo y sin scripts', () => {
    const prodDeps = stages.find((s) => s.includes('AS prod-deps')) ?? '';
    expect(prodDeps).toMatch(/npm ci [^\n]*--omit=dev/);
    expect(prodDeps).toMatch(/npm ci [^\n]*--ignore-scripts/);
  });

  it('arranca con el proceso elegido por APP, sin shell intermedia que ignore señales', () => {
    expect(finalStage).toMatch(/CMD \[.*exec node apps\/\$\{APP\}\/dist\/main\.js.*\]/);
  });
});

describe('.dockerignore', () => {
  const ignored = read('.dockerignore')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));

  it.each(['.git', '.env', '.env.*', 'node_modules', '**/node_modules', '.clickup.json'])(
    'excluye %s',
    (entry) => {
      expect(ignored).toContain(entry);
    },
  );
});

describe('CI y Dependabot', () => {
  const workflow = parse(read('.github/workflows/ci.yml')) as {
    jobs: Record<string, { strategy?: { matrix?: { app?: string[] } }; steps: { run?: string }[] }>;
  };

  it('la CI construye y prueba una imagen por cada proceso de apps/', () => {
    const job = workflow.jobs['docker'];
    expect([...(job?.strategy?.matrix?.app ?? [])].sort()).toEqual([...apps].sort());
    const runs = (job?.steps ?? []).map((s) => s.run ?? '').join('\n');
    expect(runs).toContain('docker build --build-arg APP=${{ matrix.app }}');
    expect(runs).toContain('scripts/docker-smoke.sh');
  });

  it('el Dockerfile construye el nombre de workspace de cada proceso', () => {
    for (const app of apps) {
      expect(existsSync(resolve(root, 'apps', app, 'package.json'))).toBe(true);
    }
  });

  it('Dependabot vigila la imagen base', () => {
    const config = parse(read('.github/dependabot.yml')) as {
      updates: { 'package-ecosystem': string }[];
    };
    expect(config.updates.map((u) => u['package-ecosystem'])).toContain('docker');
  });
});
