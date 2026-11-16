import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Navigate, useLocation } from 'react-router';
import type { Api } from '../api/client';
import type { Me, Role } from '../api/session';

const ApiContext = createContext<Api | null>(null);

export function ApiProvider({ api, children }: { api: Api; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (api === null) throw new Error('falta <ApiProvider>');
  return api;
}

/** Usuario autenticado (o `null`); se actualiza con cada cambio de sesión. */
export function useMe(): Me | null {
  const { session } = useApi();
  useSyncExternalStore(session.subscribe, session.getVersion);
  return session.me;
}

/** Recupera la sesión al cargar la página (refresco guardado → `/me`) antes de pintar las rutas. */
export function SessionBootstrap({ children }: { children: ReactNode }) {
  const api = useApi();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void api.restore().finally(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, [api]);
  return ready ? (
    children
  ) : (
    <p role="status" className="p-10 text-center text-ink-soft">
      Cargando…
    </p>
  );
}

/**
 * Ruta protegida. La interfaz solo oculta lo que el backend ya deniega: no es una barrera de
 * seguridad, la autorización real está en la API y en GraphQL.
 */
export function RequireRole({ roles, children }: { roles?: readonly Role[]; children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me === null) {
    const back = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/entrar?volver=${back}`} replace />;
  }
  if (roles !== undefined && !roles.includes(me.role)) {
    return (
      <p role="alert" className="py-16 text-center text-lg">
        No tienes permiso para ver esta página.
      </p>
    );
  }
  return children;
}

export const CREATOR_ROLES: readonly Role[] = ['ADMIN', 'SELLER'];
