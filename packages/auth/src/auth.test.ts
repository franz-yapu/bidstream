import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  bearerToken,
  hashPassword,
  hashRefreshToken,
  InvalidAccessToken,
  loadAuthConfig,
  newRefreshToken,
  passwordProblems,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
  type Identity,
  type TokenSigner,
  type TokenVerifier,
} from './index.js';

const A = generateKeyPairSync('ed25519');
const B = generateKeyPairSync('ed25519');
const identity: Identity = {
  userId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  role: 'BIDDER',
};
const signer: TokenSigner = {
  kid: 'k1',
  privateKey: A.privateKey,
  issuer: 'bidstream',
  audience: 'bidstream',
};
const verifier: TokenVerifier = {
  keys: new Map([['k1', createPublicKey(A.privateKey)]]),
  issuer: 'bidstream',
  audience: 'bidstream',
};
const NOW = new Date('2026-11-14T12:00:00.000Z');

describe('Argon2id', () => {
  it('verifica la contraseña correcta y rechaza la incorrecta; dos hashes de la misma clave difieren', async () => {
    const hash = await hashPassword('una-contraseña-larga-123');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(hash, 'una-contraseña-larga-123')).toBe(true);
    expect(await verifyPassword(hash, 'una-contraseña-larga-124')).toBe(false);
    expect(await hashPassword('una-contraseña-larga-123')).not.toBe(hash);
  });

  it('un hash malformado es falso, no una excepción', async () => {
    expect(await verifyPassword('esto-no-es-un-hash', 'x')).toBe(false);
    expect(await verifyPassword('', '')).toBe(false);
  });
});

describe('política de contraseñas', () => {
  it('exige longitud y rechaza repetidas o con el nombre del correo', () => {
    expect(passwordProblems('corta', 'a@b.co')).toHaveLength(1);
    expect(passwordProblems('a'.repeat(12), 'a@b.co').join()).toContain('repetido');
    expect(passwordProblems('x'.repeat(129), 'a@b.co').join()).toContain('como máximo');
    expect(passwordProblems('maria-lopez-2026!', 'maria.lopez@x.co')).toEqual([]);
    expect(passwordProblems('MARIA.LOPEZ-123456', 'maria.lopez@x.co').join()).toContain('correo');
    expect(passwordProblems('una-contraseña-segura-1', 'a@b.co')).toEqual([]);
  });
});

describe('JWT de acceso', () => {
  it('firma y verifica; lleva sub, tid y role', async () => {
    const token = await signAccessToken(signer, identity, 600, NOW);
    expect(await verifyAccessToken(token, verifier, NOW)).toEqual(identity);
  });

  it('caduca: válido dentro de la vida y rechazado después', async () => {
    const token = await signAccessToken(signer, identity, 600, NOW);
    expect(await verifyAccessToken(token, verifier, new Date(NOW.getTime() + 599_000))).toEqual(
      identity,
    );
    await expect(
      verifyAccessToken(token, verifier, new Date(NOW.getTime() + 700_000)),
    ).rejects.toThrow(InvalidAccessToken);
  });

  it('rechaza firma alterada, otra clave, kid desconocido, emisor o audiencia distintos', async () => {
    const token = await signAccessToken(signer, identity, 600, NOW);
    const [h, p, s] = token.split('.');
    const flipped = `${h ?? ''}.${p ?? ''}.${(s ?? '').slice(0, -3)}AAA`;
    const other = await signAccessToken(
      { ...signer, privateKey: B.privateKey },
      identity,
      600,
      NOW,
    );
    const unknownKid = await signAccessToken({ ...signer, kid: 'otra' }, identity, 600, NOW);
    const wrongIss = await signAccessToken({ ...signer, issuer: 'otro' }, identity, 600, NOW);
    const wrongAud = await signAccessToken({ ...signer, audience: 'otro' }, identity, 600, NOW);
    for (const bad of [flipped, other, unknownKid, wrongIss, wrongAud, '', 'a.b.c', 'no-es-jwt']) {
      await expect(verifyAccessToken(bad, verifier, NOW)).rejects.toThrow(InvalidAccessToken);
    }
  });

  it('rechaza alg none y HS256 firmado con la clave pública como secreto', async () => {
    const claims = { tid: identity.tenantId, role: 'ADMIN' };
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({
        ...claims,
        sub: identity.userId,
        jti: 'x',
        iss: 'bidstream',
        aud: 'bidstream',
        exp: 9_999_999_999,
      }),
    ).toString('base64url')}.`;
    const publicPem = createPublicKey(A.privateKey)
      .export({ type: 'spki', format: 'pem' })
      .toString();
    const hs256 = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setSubject(identity.userId)
      .setJti('x')
      .setIssuer('bidstream')
      .setAudience('bidstream')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(publicPem));
    for (const bad of [none, hs256]) {
      await expect(verifyAccessToken(bad, verifier)).rejects.toThrow(InvalidAccessToken);
    }
  });

  it('rechaza un rol inventado o un sub que no es UUID', async () => {
    const forged = await new SignJWT({ tid: identity.tenantId, role: 'SUPERADMIN' })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'k1' })
      .setSubject(identity.userId)
      .setJti('x')
      .setIssuer('bidstream')
      .setAudience('bidstream')
      .setExpirationTime('1h')
      .sign(A.privateKey);
    await expect(verifyAccessToken(forged, verifier)).rejects.toThrow(InvalidAccessToken);
  });

  it('rotación: acepta las claves de la lista y deja de aceptar una retirada', async () => {
    const token = await signAccessToken(signer, identity, 600, NOW);
    const retired: TokenVerifier = {
      ...verifier,
      keys: new Map([['k2', createPublicKey(B.privateKey)]]),
    };
    await expect(verifyAccessToken(token, retired, NOW)).rejects.toThrow(InvalidAccessToken);
  });
});

describe('refresh tokens y cabecera Bearer', () => {
  it('son aleatorios, opacos y se guardan solo como SHA-256', () => {
    const a = newRefreshToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newRefreshToken()).not.toBe(a);
    expect(hashRefreshToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(a)).not.toContain(a);
  });

  it('bearerToken solo acepta «Bearer <token>» bien formado', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    for (const bad of [
      undefined,
      '',
      'Bearer',
      'Bearer ',
      'Basic abc',
      'bearer abc',
      'Bearer a b',
      'Bearer a\nb',
    ]) {
      expect(bearerToken(bad)).toBeUndefined();
    }
  });
});

describe('configuración', () => {
  const privatePem = Buffer.from(
    A.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  ).toString('base64');
  const publicPem = Buffer.from(
    createPublicKey(B.privateKey).export({ type: 'spki', format: 'pem' }).toString(),
  ).toString('base64');

  it('quien emite deduce su clave pública; quien solo verifica usa la lista', () => {
    const issuer = loadAuthConfig({ AUTH_JWT_PRIVATE_KEY: privatePem, AUTH_JWT_KEY_ID: 'k1' });
    expect(issuer.signer?.kid).toBe('k1');
    expect(issuer.verifier.keys.has('k1')).toBe(true);
    expect(issuer).toMatchObject({
      accessTtlSeconds: 600,
      refreshTtlSeconds: 604_800,
      maxFailedAttempts: 5,
      lockMinutes: 15,
    });
    const verifierOnly = loadAuthConfig({
      AUTH_JWT_PUBLIC_KEYS: JSON.stringify({ k2: publicPem }),
    });
    expect(verifierOnly.signer).toBeNull();
    expect([...verifierOnly.verifier.keys.keys()]).toEqual(['k2']);
  });

  it('exige alguna clave y el kid de la privada; limita la vida del token de acceso', () => {
    expect(() => loadAuthConfig({})).toThrow(/AUTH_JWT/);
    expect(() => loadAuthConfig({ AUTH_JWT_PRIVATE_KEY: privatePem })).toThrow(/AUTH_JWT_KEY_ID/);
    const base = { AUTH_JWT_PRIVATE_KEY: privatePem, AUTH_JWT_KEY_ID: 'k1' };
    expect(() => loadAuthConfig({ ...base, AUTH_ACCESS_TTL_SECONDS: '86400' })).toThrow();
    expect(() => loadAuthConfig({ ...base, AUTH_ACCESS_TTL_SECONDS: '5' })).toThrow();
  });

  it('el error de una clave inválida no incluye su contenido', () => {
    try {
      loadAuthConfig({
        AUTH_JWT_PRIVATE_KEY: 'contenido-secreto-no-es-pem',
        AUTH_JWT_KEY_ID: 'k1',
      });
    } catch (error) {
      expect(String(error)).not.toContain('contenido-secreto-no-es-pem');
    }
  });
});
