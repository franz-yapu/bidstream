import { createHash, randomBytes, randomUUID, type KeyObject } from 'node:crypto';
import { jwtVerify, SignJWT, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { InvalidAccessToken } from './errors.js';

export const ROLES = ['ADMIN', 'SELLER', 'BIDDER'] as const;
export type Role = (typeof ROLES)[number];

/** Lo que el sistema necesita saber de quien hace la petición. */
export interface Identity {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: Role;
}

export interface TokenSigner {
  readonly kid: string;
  readonly privateKey: KeyObject;
  readonly issuer: string;
  readonly audience: string;
}

export interface TokenVerifier {
  /** Claves públicas por `kid`; retirar una invalida los tokens firmados con ella. */
  readonly keys: ReadonlyMap<string, KeyObject>;
  readonly issuer: string;
  readonly audience: string;
}

const claimsSchema = z.object({
  sub: z.uuid(),
  tid: z.uuid(),
  role: z.enum(ROLES),
  jti: z.string().min(1),
});

/** JWT de acceso EdDSA (Ed25519), corto: `sub`, `tid` (tenant), `role` y `jti`. */
export function signAccessToken(
  signer: TokenSigner,
  identity: Identity,
  ttlSeconds: number,
  now: Date,
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({ tid: identity.tenantId, role: identity.role })
    .setProtectedHeader({ alg: 'EdDSA', kid: signer.kid, typ: 'JWT' })
    .setSubject(identity.userId)
    .setJti(randomUUID())
    .setIssuer(signer.issuer)
    .setAudience(signer.audience)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ttlSeconds)
    .sign(signer.privateKey);
}

/**
 * Verifica un JWT de acceso. Solo acepta `EdDSA` (nunca `none` ni HS256 con la clave pública como
 * secreto), el emisor y la audiencia esperados, y una clave conocida por `kid`.
 */
export async function verifyAccessToken(
  token: string,
  verifier: TokenVerifier,
  now: Date = new Date(),
): Promise<Identity> {
  const getKey: JWTVerifyGetKey = (header) => {
    const key = verifier.keys.get(header.kid ?? '');
    if (key === undefined) throw new InvalidAccessToken();
    return key;
  };
  try {
    const { payload } = await jwtVerify(token, getKey, {
      algorithms: ['EdDSA'],
      issuer: verifier.issuer,
      audience: verifier.audience,
      currentDate: now,
      clockTolerance: 5,
    });
    const claims = claimsSchema.parse(payload);
    return { userId: claims.sub, tenantId: claims.tid, role: claims.role };
  } catch {
    throw new InvalidAccessToken();
  }
}

/** Valor opaco para el refresh token: 32 bytes aleatorios. Solo se guarda su hash. */
export const newRefreshToken = (): string => randomBytes(32).toString('base64url');

export const hashRefreshToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** Extrae el token de `Authorization: Bearer <token>`; `undefined` si falta o no es Bearer. */
export function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header);
  return match?.[1];
}
