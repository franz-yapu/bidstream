import type { KeyObject } from 'node:crypto';
import { KEY_ID_HEADER, SIGNATURE_HEADER, verifySignature } from './sign.js';

/** Lo mínimo que se necesita de un mensaje entrante (compatible con `IncomingMessage` de Kafka). */
export interface SignedMessage {
  readonly value: string | null;
  readonly headers: Readonly<Record<string, string>>;
}

export type SignatureMode = 'enforce' | 'off';

export interface VerifierOptions<T> {
  readonly mode: SignatureMode;
  /** Claves públicas por `kid`. Retirar un `kid` deja de aceptar lo firmado con él. */
  readonly keys: ReadonlyMap<string, KeyObject>;
  /**
   * Instante a partir del cual todo mensaje debe ir firmado. Lo anterior sin firma se acepta, para que
   * el reproceso desde `earliest` no rechace el historial previo a la firma. Sin valor: todo se firma.
   */
  readonly requiredFrom?: Date | undefined;
  /** Instante del mensaje (`occurredAt` de un evento, `receivedAt` de un comando). */
  readonly timestampOf: (value: T) => string;
}

/**
 * Verificador para el gancho `verify` del procesador (D3): `false` trata el mensaje como veneno (DLQ,
 * sin reintentos). Una firma presente **siempre** se comprueba, aunque el mensaje sea anterior al corte.
 *
 * Límite conocido: la fecha de un mensaje sin firma la declara el propio mensaje, así que el corte
 * `requiredFrom` solo protege hasta que el historial esté sellado; cuando lo esté, hay que quitarlo.
 */
export function createMessageVerifier<T>(
  options: VerifierOptions<T>,
): (message: SignedMessage, value: T) => boolean {
  return (message, value) => {
    if (options.mode === 'off') return true;
    const signature = message.headers[SIGNATURE_HEADER];
    if (signature === undefined || signature === '') {
      const from = options.requiredFrom;
      if (from === undefined) return false;
      const when = Date.parse(options.timestampOf(value));
      return Number.isFinite(when) && when < from.getTime();
    }
    const key = options.keys.get(message.headers[KEY_ID_HEADER] ?? '');
    if (key === undefined || message.value === null) return false;
    return verifySignature(message.value, signature, key);
  };
}
