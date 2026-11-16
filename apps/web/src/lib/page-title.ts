import { useEffect } from 'react';

const SUFFIX = 'bidstream';

/** Pone el título de la pestaña («Lote · bidstream»); sin título deja solo el nombre del sitio. */
export function usePageTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · ${SUFFIX}` : `${SUFFIX} · subastas`;
  }, [title]);
}
