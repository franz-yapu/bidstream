import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { createPrismaClient, type PrismaClient } from '@bidstream/db';
import pg from 'pg';

const execFileAsync = promisify(execFile);

const DEFAULT_URL = 'postgresql://bidstream:bidstream@localhost:5432/bidstream';
// packages/testing/{src,dist} → packages/db
const DB_PACKAGE_DIR = resolve(import.meta.dirname, '../../db');

export interface TestDatabase {
  readonly url: string;
  readonly prisma: PrismaClient;
  readonly pool: pg.Pool;
  /** Cierra las conexiones y elimina la base de datos. */
  drop(): Promise<void>;
}

/** URL base del servidor de pruebas: `DATABASE_URL` del entorno o la de `make up`. */
export function testDatabaseServerUrl(): string {
  return process.env['DATABASE_URL'] ?? DEFAULT_URL;
}

/**
 * Crea una base de datos desechable (`bidstream_test_<uuid>`) en el PostgreSQL de `make up`, le
 * aplica las migraciones y devuelve un cliente Prisma y un pool `pg`. Cada suite obtiene la suya,
 * así que no se pisan ni dejan datos.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const serverUrl = testDatabaseServerUrl();
  const name = `bidstream_test_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const testUrl = url.toString();

  const admin = new pg.Client({ connectionString: serverUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  await execFileAsync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: DB_PACKAGE_DIR,
    env: { ...process.env, DATABASE_URL: testUrl },
  });

  const pool = new pg.Pool({ connectionString: testUrl });
  const prisma = createPrismaClient(testUrl);

  return {
    url: testUrl,
    prisma,
    pool,
    drop: async () => {
      await prisma.$disconnect();
      await pool.end();
      const cleaner = new pg.Client({ connectionString: serverUrl });
      await cleaner.connect();
      try {
        await cleaner.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await cleaner.end();
      }
    },
  };
}
