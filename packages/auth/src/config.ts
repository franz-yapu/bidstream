import { createPublicKey, type KeyObject } from 'node:crypto';
import { parsePrivateKey, parsePublicKey } from '@bidstream/signing';
import { z } from 'zod';
import type { TokenSigner, TokenVerifier } from './tokens.js';

type Env = Readonly<Record<string, string | undefined>>;

const schema = z.object({
  AUTH_JWT_PRIVATE_KEY: z.string().min(1).optional(),
  AUTH_JWT_KEY_ID: z.string().min(1).optional(),
  AUTH_JWT_PUBLIC_KEYS: z.string().min(1).optional(),
  AUTH_JWT_ISSUER: z.string().min(1).default('bidstream'),
  AUTH_JWT_AUDIENCE: z.string().min(1).default('bidstream'),
  AUTH_ACCESS_TTL_SECONDS: z.coerce.number().int().min(30).max(3_600).default(600),
  AUTH_REFRESH_TTL_SECONDS: z.coerce.number().int().min(300).default(604_800),
  AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  AUTH_LOCK_MINUTES: z.coerce.number().int().min(1).default(15),
});

export interface AuthConfig {
  /** Solo en quien emite tokens (la API); los verificadores (GraphQL) no la necesitan. */
  readonly signer: TokenSigner | null;
  readonly verifier: TokenVerifier;
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;
  readonly maxFailedAttempts: number;
  readonly lockMinutes: number;
}

/**
 * Configuración de autenticación (F1). Quien emite tokens tiene `AUTH_JWT_PRIVATE_KEY` +
 * `AUTH_JWT_KEY_ID` (su clave pública se deduce de la privada); quien solo verifica usa
 * `AUTH_JWT_PUBLIC_KEYS`, un JSON `{ "<kid>": "<PEM o PEM en base64>" }` que también permite rotar.
 */
export function loadAuthConfig(env: Env): AuthConfig {
  const parsed = schema.parse(env);
  const keys = new Map<string, KeyObject>();
  let signer: TokenSigner | null = null;
  if (parsed.AUTH_JWT_PRIVATE_KEY !== undefined) {
    if (parsed.AUTH_JWT_KEY_ID === undefined) {
      throw new Error('AUTH_JWT_KEY_ID es obligatorio cuando hay AUTH_JWT_PRIVATE_KEY');
    }
    const privateKey = parsePrivateKey(parsed.AUTH_JWT_PRIVATE_KEY);
    signer = {
      kid: parsed.AUTH_JWT_KEY_ID,
      privateKey,
      issuer: parsed.AUTH_JWT_ISSUER,
      audience: parsed.AUTH_JWT_AUDIENCE,
    };
    keys.set(parsed.AUTH_JWT_KEY_ID, createPublicKey(privateKey));
  }
  if (parsed.AUTH_JWT_PUBLIC_KEYS !== undefined) {
    const raw: unknown = JSON.parse(parsed.AUTH_JWT_PUBLIC_KEYS);
    for (const [kid, pem] of Object.entries(
      z.record(z.string().min(1), z.string().min(1)).parse(raw),
    )) {
      keys.set(kid, parsePublicKey(pem));
    }
  }
  if (keys.size === 0) {
    throw new Error('la autenticación exige AUTH_JWT_PRIVATE_KEY o AUTH_JWT_PUBLIC_KEYS');
  }
  return {
    signer,
    verifier: { keys, issuer: parsed.AUTH_JWT_ISSUER, audience: parsed.AUTH_JWT_AUDIENCE },
    accessTtlSeconds: parsed.AUTH_ACCESS_TTL_SECONDS,
    refreshTtlSeconds: parsed.AUTH_REFRESH_TTL_SECONDS,
    maxFailedAttempts: parsed.AUTH_MAX_FAILED_ATTEMPTS,
    lockMinutes: parsed.AUTH_LOCK_MINUTES,
  };
}
