import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';

/** Un par Ed25519 en PEM (PKCS#8 la privada, SPKI la pública). */
export interface KeyPairPem {
  readonly privateKey: string;
  readonly publicKey: string;
}

export function generateKeyPair(): KeyPairPem {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/** Acepta un PEM tal cual o codificado en base64 (más cómodo en una variable de entorno). */
export function decodePem(value: string): string {
  const trimmed = value.trim();
  return trimmed.includes('-----BEGIN') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8');
}

export const encodePemForEnv = (pem: string): string => Buffer.from(pem, 'utf8').toString('base64');

export function parsePrivateKey(value: string): KeyObject {
  const key = createPrivateKey(decodePem(value));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('la clave de firma debe ser Ed25519');
  return key;
}

export function parsePublicKey(value: string): KeyObject {
  const key = createPublicKey(decodePem(value));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('la clave pública debe ser Ed25519');
  return key;
}
