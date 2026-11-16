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
  return ready ? children : <p className="p-8 text-center text-sm opacity-70">Cargando…</p>;
}

/**
 * Ruta protegida. La interfaz solo oculta lo que el backend ya deniega: no es una barrera de
 * seguridad, la autorización real está en la API y en GraphQL.
 */
export function RequireRole({ roles, children }: { roles?: readonly Role[]; children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me === null) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles !== undefined && !roles.includes(me.role)) {
    return (
      <p role="alert" className="p-8 text-center">
        No tienes permiso para ver esta página.
      </p>
    );
  }
  return children;
}

export const CREATOR_ROLES: readonly Role[] = ['ADMIN', 'SELLER'];
