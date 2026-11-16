import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Barrera de la infraestructura (H1): no sustituye a `az bicep build`, pero impide que un módulo
// desaparezca, que un proceso de apps/ quede sin Container App o que un secreto se cuele como literal
// en el repo. El despliegue real es H3 y depende de Q1 (docs/sdd/H1/SDD.md §4).
const root = resolve(import.meta.dirname, '../../../..');
const infra = resolve(root, 'infra');
const read = (path: string): string => readFileSync(resolve(infra, path), 'utf8');
const main = read('main.bicep');
const eventHubs = read('modules/eventhubs.bicep');
const postgres = read('modules/postgres.bicep');
const keyVault = read('modules/keyvault.bicep');
const acr = read('modules/acr.bicep');
const containerApps = read('modules/containerapps.bicep');
const readme = read('README.md');
const params = read('main.bicepparam.example');
const all = [main, eventHubs, postgres, keyVault, acr, containerApps].join('\n');

/** Apps reales del monorepo: la infraestructura no debe quedarse atrás. */
const apps = readdirSync(resolve(root, 'apps'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe('estructura de la infraestructura', () => {
  it('tiene main, los cinco módulos, README y ejemplo de parámetros', () => {
    for (const file of [
      'main.bicep',
      'modules/eventhubs.bicep',
      'modules/postgres.bicep',
      'modules/keyvault.bicep',
      'modules/acr.bicep',
      'modules/containerapps.bicep',
      'README.md',
      'main.bicepparam.example',
    ]) {
      expect(existsSync(resolve(infra, file)), file).toBe(true);
    }
  });

  it('main despliega en un grupo de recursos y conecta todos los módulos', () => {
    expect(main).toContain("targetScope = 'resourceGroup'");
    for (const module of ['eventHubs', 'postgres', 'acr', 'keyVault', 'containerApps']) {
      expect(main, module).toContain(`module ${module} 'modules/`);
    }
  });

  it('los parámetros secretos son @secure()', () => {
    const secure = [...main.matchAll(/@secure\(\)\n(?:@description\([^\n]+\)\n)?param (\w+)/g)].map(
      (m) => m[1],
    );
    expect(secure).toEqual(
      expect.arrayContaining([
        'postgresAdminPassword',
        'authJwtPrivateKey',
        'authJwtPublicKeys',
        'eventSigningPrivateKey',
        'eventVerificationKeys',
        'bootstrapAdminPassword',
      ]),
    );
  });
});

describe('Event Hubs (spec §4)', () => {
  it('crea los tres hubs con las particiones de la spec', () => {
    expect(eventHubs).toMatch(/name: 'bidstream\.commands\.bid'\s+partitions: 6/);
    expect(eventHubs).toMatch(/name: 'bidstream\.events\.lot'\s+partitions: 6/);
    expect(eventHubs).toMatch(/name: 'bidstream\.events\.lot\.dlq'\s+partitions: 1/);
  });

  it('crea los grupos de consumo reales', () => {
    for (const group of [
      'projector',
      'notifier',
      'auditor',
      'decider',
      'decider-state',
      'dlq-reprocessor',
    ]) {
      expect(eventHubs, group).toContain(`'${group}'`);
    }
  });

  it('usa TLS 1.2 y una regla sin Manage', () => {
    expect(eventHubs).toContain("minimumTlsVersion: '1.2'");
    expect(eventHubs).toMatch(/rights: \[\n\s+'Send'\n\s+'Listen'/);
    expect(eventHubs).not.toContain("'Manage'");
  });
});

describe('seguridad de los servicios (spec §8)', () => {
  it('PostgreSQL exige TLS', () => {
    expect(postgres).toContain("name: 'require_secure_transport'");
    expect(postgres).toMatch(/name: 'require_secure_transport'[\s\S]*?value: 'ON'/);
  });

  it('Key Vault usa RBAC, soft delete y purge protection', () => {
    expect(keyVault).toContain('enableRbacAuthorization: true');
    expect(keyVault).toContain('enableSoftDelete: true');
    expect(keyVault).toContain('enablePurgeProtection: true');
  });

  it('ACR no tiene usuario administrador', () => {
    expect(acr).toContain('adminUserEnabled: false');
  });

  it('no hay secretos literales ni conexiones con contraseña', () => {
    expect(all).not.toContain('-----BEGIN');
    expect(all).not.toMatch(/SharedAccessKey=/);
    expect(all).not.toMatch(/postgresql:\/\/[^$]/);
  });
});

describe('Container Apps y procesos reales', () => {
  it(`cada app de apps/ tiene su Container App (${apps.join(', ')})`, () => {
    expect(apps).toEqual([
      'api',
      'auditor',
      'closer',
      'decider',
      'graphql',
      'notifier',
      'projector',
      'relay',
      'web',
    ]);
    for (const app of apps) {
      expect(containerApps, app).toMatch(new RegExp(`name: '${app}'`));
    }
    expect(containerApps).toContain('bidstream-${app.name}:${imageTag}');
  });

  it('solo API, GraphQL y el front tienen ingress externo', () => {
    for (const app of ['api', 'graphql', 'web']) {
      expect(containerApps, app).toMatch(new RegExp(`name: '${app}'\\n\\s+external: true`));
    }
    for (const app of apps.filter((name) => !['api', 'graphql', 'web'].includes(name))) {
      expect(containerApps, app).toMatch(new RegExp(`name: '${app}'\\n\\s+external: false`));
    }
  });

  it('los secretos se resuelven por Key Vault con la identidad administrada', () => {
    expect(containerApps).toContain("keyVaultUrl: '${keyVaultUri}secrets/${secret}'");
    expect(containerApps).toContain('identity: identityId');
    expect(containerApps).toContain("destination: 'log-analytics'");
  });
});

describe('operación', () => {
  it('el ejemplo de parámetros lee los secretos del entorno', () => {
    expect(params).toContain("using 'main.bicep'");
    expect(params).toContain("readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')");
    expect(params).toContain("readEnvironmentVariable('AUTH_JWT_PRIVATE_KEY')");
    expect(params).not.toMatch(/param \w+ = '[A-Za-z0-9+/]{20,}'/);
  });

  it('el README valida con Bicep y advierte del coste', () => {
    expect(readme).toContain('az bicep build --file infra/main.bicep');
    expect(readme).toMatch(/cobran \*\*por hora\*\*/);
    expect(readme).toContain('az group delete');
  });
});
