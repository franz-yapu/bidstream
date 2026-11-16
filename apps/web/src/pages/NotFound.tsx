import { Link } from 'react-router';
import { usePageTitle } from '../lib/page-title';

export function NotFoundPage() {
  usePageTitle('Página no encontrada');
  return (
    <section className="pt-10 pb-16">
      <p className="display num text-[clamp(5rem,16vw,11rem)] leading-none text-forest">404</p>
      <h1 className="mt-4 text-4xl sm:text-5xl">Esta página no existe</h1>
      <p className="mt-4 max-w-lg text-lg text-ink-soft">
        Puede que el enlace esté mal escrito o que el lote o la subasta ya no estén disponibles.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link to="/" className="btn">
          Ir al inicio
        </Link>
        <Link to="/subastas" className="btn-secondary">
          Ver subastas
        </Link>
        <Link to="/lotes" className="btn-secondary">
          Ver todos los lotes
        </Link>
      </div>
    </section>
  );
}
