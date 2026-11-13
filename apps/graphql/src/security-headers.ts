import type { Plugin } from 'graphql-yoga';
import type { Config } from './config.js';

/**
 * Cabeceras de seguridad de toda respuesta GraphQL (OWASP A05). La CSP estricta no se aplica con GraphiQL
 * (solo en desarrollo), que necesita cargar sus propios scripts; HSTS solo en producción.
 */
export function securityHeaders(config: Pick<Config, 'NODE_ENV'>): Plugin {
  const headers: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
    'cache-control': 'no-store',
    ...(config.NODE_ENV === 'development'
      ? {}
      : { 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" }),
    ...(config.NODE_ENV === 'production'
      ? { 'strict-transport-security': 'max-age=15552000; includeSubDomains' }
      : {}),
  };
  return {
    onResponse({ response }) {
      for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    },
  };
}
