import { z } from 'zod';
import { parsePrivateKey, parsePublicKey } from './keys.js';
import type { SigningKey } from './sign.js';
import { createMessageVerifier, type SignatureMode, type SignedMessage } from './verifier.js';

type Env = Readonly<Record<string, string | undefined>>;

const optionalString = z.string().min(1).optional();

const signingSchema = z.object({
  EVENT_SIGNING_PRIVATE_KEY: optionalString,
  EVENT_SIGNING_KEY_ID: optionalString,
});

/**
 * Clave de firma del relay. Sin `EVENT_SIGNING_PRIVATE_KEY` no se firma (`null`); con ella,
 * `EVENT_SIGNING_KEY_ID` es obligatorio.
 */
export function loadSigningKey(env: Env): SigningKey | null {
  const parsed = signingSchema.parse(env);
  if (parsed.EVENT_SIGNING_PRIVATE_KEY === undefined) return null;
  if (parsed.EVENT_SIGNING_KEY_ID === undefined) {
    throw new Error('EVENT_SIGNING_KEY_ID es obligatorio cuando hay EVENT_SIGNING_PRIVATE_KEY');
  }
  return {
    kid: parsed.EVENT_SIGNING_KEY_ID,
    key: parsePrivateKey(parsed.EVENT_SIGNING_PRIVATE_KEY),
  };
}

const verificationSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  EVENT_SIGNATURE_MODE: z.enum(['enforce', 'off']).optional(),
  EVENT_VERIFICATION_KEYS: optionalString,
  EVENT_SIGNING_REQUIRED_FROM: z.iso.datetime().optional(),
});

export interface VerificationConfig {
  readonly mode: SignatureMode;
  readonly keys: ReadonlyMap<string, ReturnType<typeof parsePublicKey>>;
  readonly requiredFrom: Date | undefined;
}

/**
 * Configuración de verificación de los consumidores. El modo por defecto es `enforce` en producción
 * y `off` fuera de ella; con `enforce` es obligatorio tener al menos una clave pública.
 * `EVENT_VERIFICATION_KEYS` es un JSON `{ "<kid>": "<PEM o PEM en base64>" }`.
 */
export function loadVerificationConfig(env: Env): VerificationConfig {
  const parsed = verificationSchema.parse(env);
  const mode: SignatureMode =
    parsed.EVENT_SIGNATURE_MODE ?? (parsed.NODE_ENV === 'production' ? 'enforce' : 'off');
  const keys = new Map<string, ReturnType<typeof parsePublicKey>>();
  if (parsed.EVENT_VERIFICATION_KEYS !== undefined) {
    const raw: unknown = JSON.parse(parsed.EVENT_VERIFICATION_KEYS);
    const entries = z.record(z.string().min(1), z.string().min(1)).parse(raw);
    for (const [kid, pem] of Object.entries(entries)) keys.set(kid, parsePublicKey(pem));
  }
  if (mode === 'enforce' && keys.size === 0) {
    throw new Error(
      'EVENT_SIGNATURE_MODE=enforce exige EVENT_VERIFICATION_KEYS con al menos una clave',
    );
  }
  return {
    mode,
    keys,
    requiredFrom:
      parsed.EVENT_SIGNING_REQUIRED_FROM === undefined
        ? undefined
        : new Date(parsed.EVENT_SIGNING_REQUIRED_FROM),
  };
}

/** Verificador listo para el gancho `verify` del procesador, o `undefined` si la firma está apagada. */
export function verifierFromEnv<T>(
  env: Env,
  timestampOf: (value: T) => string,
): ((message: SignedMessage, value: T) => boolean) | undefined {
  const config = loadVerificationConfig(env);
  return config.mode === 'off' ? undefined : createMessageVerifier<T>({ ...config, timestampOf });
}
