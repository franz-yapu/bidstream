import { lazy, Suspense, type ComponentType } from 'react';
import { Skeleton } from './Skeleton';

/**
 * Página que se descarga solo al visitarla (división de código). Se llama una vez, a nivel de módulo:
 * crear el componente perezoso dentro de un render lo recargaría en cada pintado.
 */
export function lazyPage(load: () => Promise<ComponentType>): ComponentType {
  const Page = lazy(() => load().then((component) => ({ default: component })));
  return function LazyPage() {
    return (
      <Suspense
        fallback={
          <div role="status" aria-label="Cargando" className="pt-8">
            <Skeleton className="h-64" />
          </div>
        }
      >
        <Page />
      </Suspense>
    );
  };
}
