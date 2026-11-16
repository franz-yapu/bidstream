export interface AppConfig {
  /** Base de la API REST, sin barra final (por ejemplo `http://localhost:3000`). */
  readonly apiUrl: string;
  /** Endpoint GraphQL completo (por ejemplo `http://localhost:4000/graphql`). */
  readonly graphqlUrl: string;
  /** Tenant que se propone en el login (UUID); el usuario puede cambiarlo. */
  readonly defaultTenantId: string;
}

declare global {
  interface Window {
    /** La rellena `/config.js`, que genera el contenedor al arrancar (sin recompilar). */
    __BIDSTREAM_CONFIG__?: Partial<AppConfig>;
  }
}

const trimSlash = (url: string): string => url.replace(/\/+$/, '');

export function loadConfig(
  runtime: Partial<AppConfig> | undefined = window.__BIDSTREAM_CONFIG__,
): AppConfig {
  const env = import.meta.env;
  return {
    apiUrl: trimSlash(runtime?.apiUrl ?? env.VITE_API_URL ?? 'http://localhost:3000'),
    graphqlUrl: trimSlash(
      runtime?.graphqlUrl ?? env.VITE_GRAPHQL_URL ?? 'http://localhost:4000/graphql',
    ),
    defaultTenantId: runtime?.defaultTenantId ?? env.VITE_DEFAULT_TENANT_ID ?? '',
  };
}
