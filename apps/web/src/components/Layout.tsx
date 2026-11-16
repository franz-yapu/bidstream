import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { CREATOR_ROLES, useApi, useMe } from '../auth/context';

const link = ({ isActive }: { isActive: boolean }): string =>
  `rounded-full px-3.5 py-1.5 text-[15px] font-medium transition-colors duration-150 ${isActive ? 'bg-ink text-paper' : 'text-ink [@media(hover:hover)]:hover:bg-sand'}`;

export function Layout() {
  const api = useApi();
  const me = useMe();
  const navigate = useNavigate();
  const canCreate = me !== null && CREATOR_ROLES.includes(me.role);

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        Saltar al contenido
      </a>
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-5 sm:px-8">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link to="/" className="display text-[1.6rem] leading-none tracking-tight">
            bidstream
          </Link>
          <nav aria-label="Principal" className="flex flex-wrap items-center gap-1">
            <NavLink to="/subastas" end className={link}>
              Subastas
            </NavLink>
            {canCreate && (
              <NavLink to="/subastas/nueva" className={link}>
                Nueva subasta
              </NavLink>
            )}
            {me?.role === 'ADMIN' && (
              <NavLink to="/admin/dlq" className={link}>
                DLQ
              </NavLink>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {me === null ? (
            <>
              <Link to="/entrar" className="btn-secondary">
                Entrar
              </Link>
              <Link to="/entrar?modo=registro" className="btn">
                Crear cuenta
              </Link>
            </>
          ) : (
            <>
              <Link
                to="/cuenta"
                className="max-w-[14rem] truncate rounded-full px-3 py-1.5 text-[15px] font-medium [@media(hover:hover)]:hover:bg-sand"
              >
                {me.displayName}
              </Link>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  void api.logout().then(() => {
                    void navigate('/');
                  });
                }}
              >
                Salir
              </button>
            </>
          )}
        </div>
      </header>

      <main id="contenido" className="mx-auto w-full max-w-6xl flex-1 px-5 pb-20 sm:px-8">
        <Outlet />
      </main>

      <footer className="bg-forest-deep text-paper">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12 sm:px-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="display text-5xl leading-none sm:text-6xl">bidstream</p>
            <p className="mt-3 max-w-sm text-paper/80">
              Subastas en vivo, a la vista de todos. Cada puja queda registrada y cada cierre es
              limpio.
            </p>
          </div>
          <nav aria-label="Pie" className="flex flex-wrap gap-x-6 gap-y-2 text-[15px]">
            <Link to="/subastas" className="underline-offset-4 hover:underline">
              Ver subastas
            </Link>
            <Link to="/#como-funciona" className="underline-offset-4 hover:underline">
              Cómo funciona
            </Link>
            <Link to="/entrar" className="underline-offset-4 hover:underline">
              Entrar
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
