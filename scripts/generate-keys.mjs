#!/usr/bin/env node
// Genera las claves y credenciales de DESARROLLO de la demo (docs/sdd/F3/SDD.md y docs/sdd/F1/SDD.md) en
// archivos que no se versionan:
//   .env.signing.private  clave que FIRMA los eventos (F3): solo la lee el relay
//   .env.signing.public   claves de verificación de eventos: las leen los consumidores
//   .env.auth.private     clave que EMITE los JWT (F1) + el administrador inicial: solo la lee la API
//   .env.auth.public      claves de verificación de JWT: las lee GraphQL
//
//   node scripts/generate-keys.mjs [--if-missing] [--kid dev-1]
//
// En producción las claves salen de Key Vault (H1), nunca de este script.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const ifMissing = args.includes('--if-missing');
const kidIndex = args.indexOf('--kid');
const kid = kidIndex >= 0 ? (args[kidIndex + 1] ?? 'dev-1') : 'dev-1';
const FILES = {
  signingPrivate: '.env.signing.private',
  signingPublic: '.env.signing.public',
  authPrivate: '.env.auth.private',
  authPublic: '.env.auth.public',
};

if (ifMissing && Object.values(FILES).every((file) => existsSync(file))) {
  console.log('claves y credenciales de desarrollo ya presentes');
  process.exit(0);
}

const b64 = (key, type) =>
  Buffer.from(key.export({ type, format: 'pem' }).toString()).toString('base64');
const write = (file, lines, mode) => writeFileSync(file, `${lines.join('\n')}\n`, { mode });

// F3: firma de eventos
const signing = generateKeyPairSync('ed25519');
write(
  FILES.signingPrivate,
  [
    '# Clave PRIVADA de firma de eventos de desarrollo: solo la lee el relay. No se versiona.',
    `EVENT_SIGNING_KEY_ID=${kid}`,
    `EVENT_SIGNING_PRIVATE_KEY=${b64(signing.privateKey, 'pkcs8')}`,
  ],
  0o600,
);
write(FILES.signingPublic, [
  '# Claves públicas de verificación de eventos de desarrollo. No se versiona.',
  'EVENT_SIGNATURE_MODE=enforce',
  // lo publicado antes de generar las claves no está firmado: se acepta (reproceso desde earliest)
  `EVENT_SIGNING_REQUIRED_FROM=${new Date().toISOString()}`,
  `EVENT_VERIFICATION_KEYS='${JSON.stringify({ [kid]: b64(signing.publicKey, 'spki') })}'`,
]);

// F1: autenticación (otro par de claves: firmar eventos y emitir tokens son funciones distintas)
const auth = generateKeyPairSync('ed25519');
const adminPassword = randomBytes(18).toString('base64url');
write(
  FILES.authPrivate,
  [
    '# Clave PRIVADA de emisión de JWT y administrador inicial de desarrollo: solo la lee la API. No se versiona.',
    'AUTH_MODE=jwt',
    `AUTH_JWT_KEY_ID=${kid}`,
    `AUTH_JWT_PRIVATE_KEY=${b64(auth.privateKey, 'pkcs8')}`,
    'BOOTSTRAP_ADMIN_TENANT_ID=11111111-1111-4111-8111-111111111111',
    'BOOTSTRAP_ADMIN_EMAIL=admin@demo.local',
    `BOOTSTRAP_ADMIN_PASSWORD=${adminPassword}`,
  ],
  0o600,
);
write(FILES.authPublic, [
  '# Claves públicas de verificación de JWT de desarrollo. No se versiona.',
  'AUTH_MODE=jwt',
  `AUTH_JWT_PUBLIC_KEYS='${JSON.stringify({ [kid]: b64(auth.publicKey, 'spki') })}'`,
]);

console.log(`claves y credenciales de desarrollo generadas (${kid}):`);
for (const file of Object.values(FILES)) console.log(`  ${file}`);
console.log('administrador de la demo: admin@demo.local (la contraseña está en .env.auth.private)');
