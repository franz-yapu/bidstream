import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createMessageVerifier,
  encodePemForEnv,
  generateKeyPair,
  KEY_ID_HEADER,
  loadSigningKey,
  loadVerificationConfig,
  parsePrivateKey,
  parsePublicKey,
  SIGNATURE_HEADER,
  signatureHeaders,
  signMessage,
  verifierFromEnv,
  verifySignature,
} from './index.js';

const pair = generateKeyPair();
const other = generateKeyPair();
const priv = parsePrivateKey(pair.privateKey);
const pub = parsePublicKey(pair.publicKey);
const VALUE = JSON.stringify({ eventId: 'e1', type: 'BidPlaced', payload: { amount: '100.00' } });

describe('firma Ed25519', () => {
  it('firma y verifica; la firma es base64url y determinista', () => {
    const signature = signMessage(VALUE, priv);
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifySignature(VALUE, signature, pub)).toBe(true);
    expect(signMessage(VALUE, priv)).toBe(signature);
  });

  it('cambiar un solo byte del valor invalida la firma', () => {
    const signature = signMessage(VALUE, priv);
    expect(verifySignature(VALUE.replace('100.00', '100.01'), signature, pub)).toBe(false);
    expect(verifySignature(`${VALUE} `, signature, pub)).toBe(false);
  });

  it('una firma alterada, truncada o vacía no verifica ni lanza', () => {
    const signature = signMessage(VALUE, priv);
    const flipped = `${signature.slice(0, -2)}${signature.endsWith('AA') ? 'BB' : 'AA'}`;
    expect(verifySignature(VALUE, flipped, pub)).toBe(false);
    expect(verifySignature(VALUE, signature.slice(0, 10), pub)).toBe(false);
    expect(verifySignature(VALUE, '', pub)).toBe(false);
    expect(verifySignature(VALUE, '!!!no-base64!!!', pub)).toBe(false);
  });

  it('la firma de otra clave no verifica', () => {
    const signature = signMessage(VALUE, parsePrivateKey(other.privateKey));
    expect(verifySignature(VALUE, signature, pub)).toBe(false);
  });

  it('la clave pública no puede firmar (asimetría): un consumidor no falsifica eventos', () => {
    expect(() => signMessage(VALUE, pub)).toThrow();
  });

  it('firma los bytes UTF-8 exactos, también con caracteres no ASCII', () => {
    const value = JSON.stringify({ title: 'Café de especialidad ☕' });
    expect(verifySignature(value, signMessage(value, priv), pub)).toBe(true);
  });

  it('rechaza claves que no son Ed25519', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() =>
      parsePrivateKey(rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()),
    ).toThrow(/Ed25519/);
  });

  it('acepta el PEM tal cual o en base64', () => {
    expect(parsePublicKey(encodePemForEnv(pair.publicKey)).asymmetricKeyType).toBe('ed25519');
    expect(parsePrivateKey(encodePemForEnv(pair.privateKey)).asymmetricKeyType).toBe('ed25519');
  });
});

describe('verificador de mensajes', () => {
  const keys = new Map([['k1', pub]]);
  const signed = (value: string, kid = 'k1') => ({
    value,
    headers: signatureHeaders(value, { kid, key: priv }),
  });
  interface Overrides {
    mode?: 'enforce' | 'off';
    keys?: ReadonlyMap<string, KeyObject>;
    requiredFrom?: Date;
  }
  const verifier = (overrides: Overrides = {}) =>
    createMessageVerifier<{ occurredAt: string }>({
      mode: overrides.mode ?? 'enforce',
      keys: overrides.keys ?? keys,
      requiredFrom: overrides.requiredFrom,
      timestampOf: (v) => v.occurredAt,
    });
  const event = { occurredAt: '2026-11-14T12:00:00.000Z' };

  it('acepta un mensaje firmado con una clave conocida', () => {
    expect(verifier()(signed(VALUE), event)).toBe(true);
  });

  it('rechaza: valor manipulado, kid desconocido, firma ausente, valor nulo', () => {
    const ok = signed(VALUE);
    expect(verifier()({ ...ok, value: VALUE.replace('BidPlaced', 'BidRejected') }, event)).toBe(
      false,
    );
    expect(verifier()(signed(VALUE, 'otra'), event)).toBe(false);
    expect(verifier()({ value: VALUE, headers: {} }, event)).toBe(false);
    expect(verifier()({ value: null, headers: ok.headers }, event)).toBe(false);
    expect(
      verifier()(
        { value: VALUE, headers: { [SIGNATURE_HEADER]: '', [KEY_ID_HEADER]: 'k1' } },
        event,
      ),
    ).toBe(false);
  });

  it('modo off acepta todo', () => {
    expect(verifier({ mode: 'off' })({ value: VALUE, headers: {} }, event)).toBe(true);
  });

  it('rotación: acepta dos kid y deja de aceptar el retirado', () => {
    const second = generateKeyPair();
    const both = new Map([
      ['k1', pub],
      ['k2', parsePublicKey(second.publicKey)],
    ]);
    const fromK2 = {
      value: VALUE,
      headers: signatureHeaders(VALUE, { kid: 'k2', key: parsePrivateKey(second.privateKey) }),
    };
    expect(verifier({ keys: both })(fromK2, event)).toBe(true);
    expect(verifier({ keys: both })(signed(VALUE), event)).toBe(true);
    expect(
      verifier({ keys: new Map([...both].filter(([kid]) => kid === 'k2')) })(signed(VALUE), event),
    ).toBe(false);
  });

  it('el historial sin firma anterior al corte se acepta; posterior o sin corte, no', () => {
    const unsigned = { value: VALUE, headers: {} };
    const requiredFrom = new Date('2026-11-14T00:00:00.000Z');
    expect(verifier({ requiredFrom })(unsigned, { occurredAt: '2026-11-13T23:59:59.999Z' })).toBe(
      true,
    );
    expect(verifier({ requiredFrom })(unsigned, { occurredAt: '2026-11-14T00:00:00.000Z' })).toBe(
      false,
    );
    expect(verifier({ requiredFrom })(unsigned, { occurredAt: 'no-es-fecha' })).toBe(false);
    expect(verifier()(unsigned, { occurredAt: '2020-01-01T00:00:00.000Z' })).toBe(false);
  });

  it('una firma presente siempre se comprueba, aunque el mensaje sea anterior al corte', () => {
    const requiredFrom = new Date('2026-12-01T00:00:00.000Z');
    const tampered = { ...signed(VALUE), value: `${VALUE} ` };
    expect(verifier({ requiredFrom })(tampered, { occurredAt: '2020-01-01T00:00:00.000Z' })).toBe(
      false,
    );
  });
});

describe('configuración', () => {
  const env = (extra: Record<string, string> = {}) => ({
    EVENT_SIGNING_PRIVATE_KEY: encodePemForEnv(pair.privateKey),
    EVENT_SIGNING_KEY_ID: 'k1',
    EVENT_VERIFICATION_KEYS: JSON.stringify({ k1: encodePemForEnv(pair.publicKey) }),
    ...extra,
  });

  it('sin clave privada no se firma; con ella exige el kid', () => {
    expect(loadSigningKey({})).toBeNull();
    expect(loadSigningKey(env())?.kid).toBe('k1');
    expect(() =>
      loadSigningKey({ EVENT_SIGNING_PRIVATE_KEY: encodePemForEnv(pair.privateKey) }),
    ).toThrow(/EVENT_SIGNING_KEY_ID/);
  });

  it('el modo por defecto es off fuera de producción y enforce en producción', () => {
    expect(loadVerificationConfig({}).mode).toBe('off');
    expect(loadVerificationConfig({ NODE_ENV: 'test' }).mode).toBe('off');
    expect(() => loadVerificationConfig({ NODE_ENV: 'production' })).toThrow(
      /EVENT_VERIFICATION_KEYS/,
    );
    expect(loadVerificationConfig(env({ NODE_ENV: 'production' })).mode).toBe('enforce');
    expect(
      loadVerificationConfig(env({ NODE_ENV: 'production', EVENT_SIGNATURE_MODE: 'off' })).mode,
    ).toBe('off');
  });

  it('enforce sin claves públicas falla; requiredFrom debe ser una fecha ISO', () => {
    expect(() => loadVerificationConfig({ EVENT_SIGNATURE_MODE: 'enforce' })).toThrow();
    expect(
      loadVerificationConfig(env({ EVENT_SIGNING_REQUIRED_FROM: '2026-11-14T00:00:00.000Z' }))
        .requiredFrom,
    ).toEqual(new Date('2026-11-14T00:00:00.000Z'));
    expect(() => loadVerificationConfig(env({ EVENT_SIGNING_REQUIRED_FROM: 'ayer' }))).toThrow();
  });

  it('verifierFromEnv devuelve undefined con la firma apagada y un verificador con enforce', () => {
    expect(verifierFromEnv({}, () => '')).toBeUndefined();
    const verify = verifierFromEnv<{ t: string }>(
      env({ EVENT_SIGNATURE_MODE: 'enforce' }),
      (v) => v.t,
    );
    expect(
      verify?.(
        { value: VALUE, headers: signatureHeaders(VALUE, { kid: 'k1', key: priv }) },
        { t: '' },
      ),
    ).toBe(true);
  });

  it('el mensaje de error no incluye la clave privada', () => {
    try {
      loadSigningKey({ EVENT_SIGNING_PRIVATE_KEY: 'esto-no-es-una-clave' });
    } catch (error) {
      expect(String(error)).not.toContain('esto-no-es-una-clave');
    }
  });
});
