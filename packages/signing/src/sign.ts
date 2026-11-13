import { sign, verify, type KeyObject } from 'node:crypto';

/** Cabeceras Kafka que acompañan a cada mensaje firmado (F3). */
export const SIGNATURE_HEADER = 'x-signature';
export const KEY_ID_HEADER = 'x-key-id';

export interface SigningKey {
  readonly kid: string;
  readonly key: KeyObject;
}

/** Firma los **bytes exactos** del valor publicado (UTF-8). Devuelve la firma en base64url. */
export function signMessage(value: string, key: KeyObject): string {
  return sign(null, Buffer.from(value, 'utf8'), key).toString('base64url');
}

/** `true` solo si `signature` es la firma de `value` hecha con la clave privada de `publicKey`. */
export function verifySignature(value: string, signature: string, publicKey: KeyObject): boolean {
  try {
    return verify(null, Buffer.from(value, 'utf8'), publicKey, Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}

/** Las cabeceras de firma de un valor. */
export function signatureHeaders(value: string, signer: SigningKey): Record<string, string> {
  return {
    [SIGNATURE_HEADER]: signMessage(value, signer.key),
    [KEY_ID_HEADER]: signer.kid,
  };
}
