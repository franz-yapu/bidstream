#!/usr/bin/env node
// Genera un par Ed25519 de DESARROLLO para firmar eventos (F3, docs/sdd/F3/SDD.md) y lo deja en dos
// archivos que no se versionan: la clave privada solo la lee el relay; la pública, todos los demás.
//
//   node scripts/generate-keys.mjs [--if-missing] [--kid dev-1]
//
// En producción las claves salen de Key Vault (H1), nunca de este script.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const ifMissing = args.includes('--if-missing');
const kidIndex = args.indexOf('--kid');
const kid = kidIndex >= 0 ? (args[kidIndex + 1] ?? 'dev-1') : 'dev-1';
const PRIVATE_FILE = '.env.signing.private';
const PUBLIC_FILE = '.env.signing.public';

if (ifMissing && existsSync(PRIVATE_FILE) && existsSync(PUBLIC_FILE)) {
  console.log(`claves de firma ya presentes (${PRIVATE_FILE}, ${PUBLIC_FILE})`);
  process.exit(0);
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const b64 = (key, type) => Buffer.from(key.export({ type, format: 'pem' }).toString()).toString('base64');

writeFileSync(
  PRIVATE_FILE,
  `# Clave PRIVADA de desarrollo: solo la lee el relay. No se versiona.\nEVENT_SIGNING_KEY_ID=${kid}\nEVENT_SIGNING_PRIVATE_KEY=${b64(privateKey, 'pkcs8')}\n`,
  { mode: 0o600 },
);
writeFileSync(
  PUBLIC_FILE,
  [
    '# Claves públicas de desarrollo: las leen los consumidores. No se versiona.',
    'EVENT_SIGNATURE_MODE=enforce',
    // lo publicado antes de generar las claves no está firmado: se acepta (reproceso desde earliest)
    `EVENT_SIGNING_REQUIRED_FROM=${new Date().toISOString()}`,
    `EVENT_VERIFICATION_KEYS='${JSON.stringify({ [kid]: b64(publicKey, 'spki') })}'`,
    '',
  ].join('\n'),
);
console.log(`claves de firma generadas (${kid}): ${PRIVATE_FILE} (solo el relay) y ${PUBLIC_FILE}`);
