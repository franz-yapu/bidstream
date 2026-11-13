export const REDACTED = '[REDACTED]';

/** Claves cuyo valor nunca se registra (OWASP A09), a cualquier profundidad. */
const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|api[-_]?key|x-admin-key|connection[-_]?string|credential|cookie|database[-_]?url/i;

/** `scheme://usuario:CONTRASEÑA@host`: se enmascara solo la contraseña. */
const URL_PASSWORD = /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(@)/gi;

/** Enmascara la contraseña de las URL que aparezcan dentro de una cadena. */
export function maskUrlPasswords(text: string): string {
  return text.replace(URL_PASSWORD, `$1${REDACTED}$2`);
}

const MAX_DEPTH = 8;

/** Copia el valor con las claves sensibles y las contraseñas de URL enmascaradas. */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return maskUrlPasswords(value);
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (value instanceof Error) return serializeError(value, false);
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1, seen);
  }
  return out;
}

/** Un error sin su contexto interno: nombre y mensaje (y la pila solo si se pide). */
export function serializeError(error: unknown, withStack: boolean): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: maskUrlPasswords(error.message),
      ...(withStack && error.stack !== undefined ? { stack: maskUrlPasswords(error.stack) } : {}),
    };
  }
  return { message: maskUrlPasswords(typeof error === 'string' ? error : JSON.stringify(error)) };
}
