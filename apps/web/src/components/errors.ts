import { ApiError } from '../api/http';

/** Mensaje en español para el usuario a partir de un error de la API o de red. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      const wait =
        error.retryAfterSeconds === undefined
          ? ''
          : ` Reintenta en ${String(error.retryAfterSeconds)} s.`;
      return `Demasiadas peticiones.${wait}`;
    }
    if (error.status === 401) return 'Credenciales no válidas o sesión caducada.';
    if (error.status === 403) return 'No tienes permiso para hacer esto.';
    if (error.status === 404) return 'No se encontró lo que buscabas.';
    if (error.fieldErrors.length > 0) {
      return error.fieldErrors.map((e) => `${e.path}: ${e.message}`).join(' · ');
    }
    return error.detail ?? error.title;
  }
  return 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
}
