import { NavLink, Outlet, useNavigate } from 'react-router';
import { CREATOR_ROLES, useApi, useMe } from '../auth/context';

const link = ({ isActive }: { isActive: boolean }): string =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-indigo-600 text-white' : 'hover:bg-slate-200 dark:hover:bg-slate-800'}`;

const ROLE_LABEL = { ADMIN: 'Administrador', SELLER: 'Vendedor', BIDDER: 'Postor' } as const;

export function Layout() {
  const api = useApi();
  const me = useMe();
  const navigate = useNavigate();
  const canCreate = me !== null && CREATOR_ROLES.includes(me.role);

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4">
      <header className="flex flex-wrap items-center justify-between gap-3 py-4">
        <nav aria-label="Principal" className="flex flex-wrap items-center gap-1">
          <span className="mr-3 text-lg font-bold tracking-tight">bidstream</span>
          {me !== null && (
            <NavLink to="/" end className={link}>
              Subastas
            </NavLink>
          )}
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
        <div className="flex items-center gap-3 text-sm">
          {me === null ? (
            <>
              <NavLink to="/login" className={link}>
                Entrar
              </NavLink>
              <NavLink to="/registro" className={link}>
                Registrarse
              </NavLink>
            </>
          ) : (
            <>
              <span className="max-w-[16rem] truncate opacity-80">
                {me.email}
                <span className="hidden sm:inline"> · {ROLE_LABEL[me.role]}</span>
              </span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  void api.logout().then(() => {
                    void navigate('/login');
                  });
                }}
              >
                Salir
              </button>
            </>
          )}
        </div>
      </header>
      <main className="flex-1 pb-12">
        <Outlet />
      </main>
    </div>
  );
}
