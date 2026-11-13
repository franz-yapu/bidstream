import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  createTestDatabase,
  createTestTopic,
  testKafkaConfig,
  type TestDatabase,
  type TestTopic,
} from '@bidstream/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const projectorDir = resolve(import.meta.dirname, '../..');
const kafka = testKafkaConfig();

let db: TestDatabase;
let topic: TestTopic;
let dir: string;
let env: NodeJS.ProcessEnv;

beforeAll(async () => {
  db = await createTestDatabase();
  topic = await createTestTopic({ partitions: 3 });
  dir = mkdtempSync(join(tmpdir(), 'bidstream-demo-'));
  env = {
    ...process.env,
    DATABASE_URL: db.url,
    KAFKA_BROKERS: kafka.brokers.join(','),
    KAFKA_LOG_LEVEL: 'error',
    PROJECTOR_TOPIC: topic.name,
    PROJECTOR_GROUP_ID: `projector-demo-${randomUUID()}`,
  };
}, 120_000);

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await topic.drop();
  await db.drop();
});

const node = (script: string, ...args: string[]) =>
  run('node', ['--import', 'tsx', script, ...args], { cwd: projectorDir, env, timeout: 90_000 });

// H5: la demostración del reproceso no puede mentir.
describe('demostración del reproceso', () => {
  const file = (): string => join(dir, 'huella');

  it('cargar → reprocesar → verificar termina IDÉNTICO', async () => {
    const load = await node('src/demo/load.ts', file(), '1', '2', '5');
    expect(load.stdout).toMatch(/subastas=1 lotes=2 pujas=10 adjudicadas=2/);
    const before = readFileSync(file(), 'utf8').trim();
    expect(before).toMatch(/^[0-9a-f]{64}$/);

    const reprocess = await node('src/reprocess-cli.ts', '--yes');
    expect(reprocess.stdout).toContain('La proyección se reconstruyó sola');

    const verify = await node('src/demo/verify.ts', file());
    expect(verify.stdout).toContain('IDÉNTICO');
    expect(verify.stdout).toContain(before);
  }, 120_000);

  it('si la proyección reconstruida difiere, la verificación FALLA', async () => {
    await db.prisma.bid.updateMany({ data: { awarded: false } });
    await expect(node('src/demo/verify.ts', file())).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('DISTINTO') as unknown,
    });
  }, 60_000);
});
