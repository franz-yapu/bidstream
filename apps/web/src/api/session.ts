// Sesión del navegador (docs/sdd/J1/SDD.md §2.3):
//  - el token de acceso (10 min) vive SOLO en memoria: nunca en localStorage;
//  - el de refresco (opaco, de un solo uso, con rotación) va en sessionStorage: una pestaña, y se pierde al cerrarla;
//  - ante varios 401 simultáneos se hace UN solo refresco compartido (el segundo uso de un refresco lo
//    invalidaría y cerraría la sesión en el servidor).

export type Role = 'ADMIN' | 'SELLER' | 'BIDDER';

export interface Me {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: Role;
  readonly email: string;
  readonly displayName: string;
}

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}

export const REFRESH_KEY = 'bidstream.refresh';

type RefreshFn = (refreshToken: string) => Promise<TokenPair>;
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class SessionStore {
  private access: string | null = null;
  private user: Me | null = null;
  private inflight: Promise<boolean> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly refreshFn: RefreshFn,
    private readonly storage: Store | null = browserSessionStorage(),
  ) {}

  get accessToken(): string | null {
    return this.access;
  }

  get me(): Me | null {
    return this.user;
  }

  hasRefreshToken(): boolean {
    return this.readRefresh() !== null;
  }

  /** El token de refresco guardado (para revocarlo al cerrar sesión). */
  currentRefreshToken(): string | null {
    return this.readRefresh();
  }

  setTokens(pair: TokenPair): void {
    this.access = pair.accessToken;
    try {
      this.storage?.setItem(REFRESH_KEY, pair.refreshToken);
    } catch {
      // sin almacenamiento disponible: la sesión dura lo que dure la memoria de la página
    }
    this.notify();
  }

  setMe(me: Me | null): void {
    this.user = me;
    this.notify();
  }

  clear(): void {
    this.access = null;
    this.user = null;
    try {
      this.storage?.removeItem(REFRESH_KEY);
    } catch {
      // nada que borrar
    }
    this.notify();
  }

  /** Renueva el token de acceso. Compartido: varias llamadas a la vez esperan al mismo refresco. */
  refresh(): Promise<boolean> {
    this.inflight ??= this.doRefresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Versión que cambia con cada cambio de estado (para `useSyncExternalStore`). */
  private version = 0;
  getVersion = (): number => this.version;

  private async doRefresh(): Promise<boolean> {
    const refreshToken = this.readRefresh();
    if (refreshToken === null) return false;
    try {
      this.setTokens(await this.refreshFn(refreshToken));
      return true;
    } catch {
      this.clear();
      return false;
    }
  }

  private readRefresh(): string | null {
    try {
      return this.storage?.getItem(REFRESH_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private notify(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

function browserSessionStorage(): Store | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
