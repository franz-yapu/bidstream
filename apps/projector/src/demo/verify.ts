import { readFileSync } from 'node:fs';
import { createPrismaClient } from '@bidstream/db';
import { loadProjectorConfig } from '../config.js';
import { snapshotProjection } from './fingerprint.js';

/**
 * Fase 3 de la demostración (docs/sdd/H5/SDD.md): compara la huella de la proyección reconstruida
 * con la guardada antes de borrarla. Sale con código 1 si difieren: la demostración no puede mentir.
 *
 *   node --import tsx apps/projector/src/demo/verify.ts <archivo-de-huella>
 */
const file = process.argv[2];
if (file === undefined) throw new Error('falta el archivo con la huella anterior');
const before = readFileSync(file, 'utf8').trim();

const config = loadProjectorConfig(process.env);
const prisma = createPrismaClient(config.DATABASE_URL);
try {
  const snap = await snapshotProjection(prisma);
  console.log(
    `Proyección: subastas=${String(snap.auctions)} lotes=${String(snap.lots)} pujas=${String(snap.bids)} adjudicadas=${String(snap.awarded)}`,
  );
  console.log(`Huella antes:   ${before}`);
  console.log(`Huella después: ${snap.fingerprint}`);
  if (snap.fingerprint === before) {
    console.log('IDÉNTICO ✔  la proyección se reconstruyó sola, byte a byte, desde el log.');
  } else {
    console.log('DISTINTO ✘  la proyección reconstruida no coincide con la original.');
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
