import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Barrera contra regresiones de seguridad del front (J1, OWASP A02/A03/A05/A07): no construye ni
// arranca nada, comprueba el código fuente, la imagen y la configuración.
const root = resolve(import.meta.dirname, '../../../..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');

function sources(dir: string): { path: string; text: string }[] {
  return readdirSync(resolve(root, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(resolve(root, path)).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [{ path, text: read(path) }] : [];
  });
}
/** El código sin comentarios: la política mira lo que se ejecuta, no lo que se explica. */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const app = sources('apps/web/src')
  .filter((f) => !/(\.test\.tsx?|test-setup\.ts)$/.test(f.path))
  .map((f) => ({ ...f, text: stripComments(f.text) }));

describe('tipografías y pública (J2)', () => {
  it('las tipografías salen del propio sitio: sin CDN ni fuentes externas', () => {
    const html = read('apps/web/index.html');
    const css = read('apps/web/src/styles.css');
    expect(html + css).not.toMatch(/fonts\.googleapis|fonts\.gstatic|https?:\/\/.*\.(woff2?|ttf)/);
    expect(css).toMatch(/@fontsource-variable\//);
    // la CSP no admite `data:` en font-src: Vite no debe inlinar las fuentes
    expect(read('apps/web/vite.config.ts')).toMatch(/assetsInlineLimit:\s*0/);
  });

  it('las rutas públicas no exigen sesión y las de gestión sí', () => {
    const routes = read('apps/web/src/routes.tsx');
    for (const path of ["'/'", "'/subastas'", "'/lotes/:lotId'", "'/entrar'"]) {
      expect(routes, path).toMatch(
        new RegExp(`path: ${path.replace(/[/:]/g, '\\$&')}, element: <\\w+ />`),
      );
    }
    for (const path of ['/subastas/nueva', '/cuenta', '/admin/dlq']) {
      const at = routes.indexOf(`path: '${path}'`);
      expect(at, path).toBeGreaterThan(-1);
      expect(routes.slice(at, at + 120), path).toMatch(/RequireRole/);
    }
  });
});

describe('código del front', () => {
  it('los tokens no van a localStorage y el de acceso nunca se persiste', () => {
    for (const file of app) {
      expect(file.text, file.path).not.toMatch(/localStorage/);
    }
    const store = stripComments(read('apps/web/src/api/session.ts'));
    expect(store).toMatch(/sessionStorage/);
    // solo el refresco se guarda; el acceso vive en un campo de memoria
    expect(store.match(/setItem\(/g)?.length).toBe(1);
    expect(store).toMatch(/setItem\(REFRESH_KEY, pair\.refreshToken\)/);
  });

  it('no inyecta HTML crudo ni evalúa código', () => {
    for (const file of app) {
      expect(file.text, file.path).not.toMatch(
        /dangerouslySetInnerHTML|innerHTML\s*=|\beval\(|new Function\(/,
      );
    }
  });

  it('no hay secretos ni claves en las variables públicas (VITE_*)', () => {
    for (const file of app) {
      for (const name of file.text.match(/VITE_[A-Z0-9_]+/g) ?? []) {
        expect(name, file.path).not.toMatch(/SECRET|PASSWORD|TOKEN|PRIVATE|KEY/);
      }
    }
  });

  it('el dinero nunca pasa por coma flotante', () => {
    const forbidden = /parseFloat\(|Number\(\s*(amount|price|money|value)\b|toFixed\(/;
    for (const file of app.filter(
      (f) => !f.path.endsWith('http.ts') && !f.path.endsWith('time.ts'),
    )) {
      expect(file.text, file.path).not.toMatch(forbidden);
    }
  });
});

describe('imagen y servidor del front', () => {
  const dockerfile = read('apps/web/Dockerfile');

  it('las bases están fijadas por digest y la final es nginx sin privilegios', () => {
    expect(dockerfile).toMatch(/^ARG NODE_IMAGE=node:22-[\w.-]+@sha256:[0-9a-f]{64}$/m);
    expect(dockerfile).toMatch(
      /^ARG NGINX_IMAGE=nginxinc\/nginx-unprivileged@sha256:[0-9a-f]{64}$/m,
    );
    const froms = dockerfile.split('\n').filter((l) => l.startsWith('FROM '));
    for (const from of froms) expect(from).toMatch(/^FROM \$\{(NODE|NGINX)_IMAGE\} AS \w+$/);
    expect(dockerfile).not.toMatch(/^USER\s+(root|0)/m);
  });

  it('ningún ENV ni ARG lleva un secreto', () => {
    expect(dockerfile).not.toMatch(/(PASSWORD|SECRET|TOKEN|PRIVATE_KEY|DATABASE_URL)/i);
  });

  it('nginx fija la CSP restringida y cabeceras de seguridad', () => {
    const conf = read('apps/web/docker/server.conf.template');
    expect(conf).toMatch(/default-src 'none'/);
    expect(conf).toMatch(/script-src 'self'/);
    expect(conf).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(conf).toMatch(/connect-src 'self' __CONNECT_SRC__/);
    expect(conf).toMatch(/frame-ancestors 'none'/);
    for (const header of ['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options']) {
      expect(conf).toContain(header);
    }
  });

  it('el arranque valida las URL y el UUID antes de generar la configuración', () => {
    const script = read('apps/web/docker/40-bidstream-config.sh');
    expect(script).toMatch(/set -eu/);
    expect(script).toMatch(/url_re=/);
    expect(script).toMatch(/DEFAULT_TENANT_ID no es un UUID/);
  });
});

describe('composición', () => {
  const compose = parse(read('docker-compose.yml')) as {
    services: Record<string, { profiles?: string[]; environment?: Record<string, string> }>;
    'x-app': { environment: Record<string, string> };
  };

  it('el servicio web está en el perfil app y el CORS de la API lo admite con origen exacto', () => {
    expect(compose.services['web']?.profiles).toContain('app');
    const origins = compose['x-app'].environment['CORS_ALLOWED_ORIGINS'] ?? '';
    for (const origin of origins.split(',')) expect(origin).toMatch(/^https?:\/\/[^/*\s]+$/);
    expect(origins).toContain('localhost:${WEB_PORT:-8080}');
  });
});

describe('CI', () => {
  it('el e2e del front corre en el job demo con las acciones fijadas por SHA', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/npm run e2e -w @bidstream\/web/);
    for (const use of ci.match(/uses:\s*\S+/g) ?? []) {
      expect(use, use).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});
