import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { CREATOR_ROLES, useApi, useMe } from '../auth/context';

const link = ({ isActive }: { isActive: boolean }): string =>
  `rounded-full px-3.5 py-1.5 text-[15px] font-medium transition-colors duration-150 ${isActive ? 'bg-ink text-paper' : 'text-ink [@media(hover:hover)]:hover:bg-sand'}`;

export function Layout() {
  const api = useApi();
  const me = useMe();
  const navigate = useNavigate();
  const canCreate = me !== null && CREATOR_ROLES.includes(me.role);
  const [open, setOpen] = useState(false);
  const close = (): void => {
    setOpen(false);
  };

  const navLinks = (
    <>
      <NavLink to="/subastas" end className={link} onClick={close}>
        Subastas
      </NavLink>
      <NavLink to="/lotes" end className={link} onClick={close}>
        Lotes
      </NavLink>
      {canCreate && (
        <NavLink to="/subastas/nueva" className={link} onClick={close}>
          Nueva subasta
        </NavLink>
      )}
      {me?.role === 'ADMIN' && (
        <NavLink to="/admin/usuarios" className={link} onClick={close}>
          Administración
        </NavLink>
      )}
    </>
  );

  const account =
    me === null ? (
      <>
        <Link to="/entrar" className="btn-secondary" onClick={close}>
          Entrar
        </Link>
        <Link to="/entrar?modo=registro" className="btn" onClick={close}>
          Crear cuenta
        </Link>
      </>
    ) : (
      <>
        <Link
          to="/cuenta"
          onClick={close}
          className="max-w-[14rem] truncate rounded-full px-3 py-1.5 text-[15px] font-medium [@media(hover:hover)]:hover:bg-sand"
        >
          {me.displayName}
        </Link>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            close();
            void api.logout().then(() => {
              void navigate('/');
            });
          }}
        >
          Salir
        </button>
      </>
    );

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        Saltar al contenido
      </a>
      <header className="mx-auto w-full max-w-6xl px-5 py-4 sm:px-8 sm:py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-x-6">
            <Link
              to="/"
              onClick={close}
              className="display flex items-center gap-2 text-[1.6rem] leading-none tracking-tight"
            >
              <span
                aria-hidden="true"
                className="grid h-8 w-8 place-items-center rounded-full bg-ink text-[1.15rem] text-lime"
              >
                b
              </span>
              bidstream
            </Link>
            <nav aria-label="Principal" className="hidden items-center gap-1 md:flex">
              {navLinks}
            </nav>
          </div>
          <div className="hidden items-center gap-2 md:flex">{account}</div>
          <button
            type="button"
            className="btn-secondary !px-4 md:hidden"
            aria-expanded={open}
            aria-controls="menu-movil"
            onClick={() => {
              setOpen((v) => !v);
            }}
          >
            {open ? 'Cerrar' : 'Menú'}
          </button>
        </div>
        {open && (
          <div id="menu-movil" className="rise mt-4 rounded-[16px] bg-paper p-4 md:hidden">
            <nav aria-label="Principal (móvil)" className="flex flex-col gap-1">
              {navLinks}
            </nav>
            <div className="mt-4 flex flex-wrap items-center gap-2">{account}</div>
          </div>
        )}
      </header>

      <main id="contenido" className="mx-auto w-full max-w-6xl flex-1 px-5 pb-20 sm:px-8">
        <Outlet />
      </main>

      <footer className="bg-night text-ink">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12 sm:px-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="display text-5xl leading-none sm:text-6xl">bidstream</p>
            <p className="mt-3 max-w-sm text-ink-soft">
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
