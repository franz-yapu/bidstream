import type { SessionStore } from './session';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Error de la API (`problem+json`) o de red, listo para mostrarse al usuario. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly fieldErrors: readonly { path: string; message: string }[] = [],
    readonly retryAfterSeconds?: number,
  ) {
    super(detail ?? title);
    this.name = 'ApiError';
  }
}

interface Problem {
  title?: string;
  detail?: string;
  errors?: { path: string; message: string }[];
}

export async function toApiError(res: Response): Promise<ApiError> {
  let body: Problem = {};
  try {
    body = (await res.json()) as Problem;
  } catch {
    // cuerpo vacío o que no es JSON
  }
  const retryAfter = Number(res.headers.get('retry-after'));
  return new ApiError(
    res.status,
    body.title ?? `Error ${String(res.status)}`,
    body.detail,
    body.errors ?? [],
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  );
}

/**
 * `fetch` con el token de acceso. Un 401 provoca UN refresco (compartido) y un reintento; si el
 * refresco falla la sesión ya está cerrada y se devuelve el 401 original.
 */
export function createAuthedFetch(session: SessionStore, fetchFn: FetchFn): FetchFn {
  return async (url, init = {}) => {
    const send = (): Promise<Response> => {
      const headers = new Headers(init.headers);
      if (session.accessToken !== null)
        headers.set('authorization', `Bearer ${session.accessToken}`);
      return fetchFn(url, { ...init, headers });
    };
    const first = await send();
    if (first.status !== 401 || !(await session.refresh())) return first;
    return send();
  };
}
