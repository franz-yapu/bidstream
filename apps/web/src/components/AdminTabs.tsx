import { NavLink } from 'react-router';

const tab = ({ isActive }: { isActive: boolean }): string =>
  `rounded-full px-4 py-2 text-[15px] font-medium transition-[background-color] duration-150 ${isActive ? 'bg-ink text-paper' : 'bg-sand text-ink [@media(hover:hover)]:hover:bg-sand-deep'}`;

/** Secciones de la administración: la misma barra arriba de cada una. */
export function AdminTabs() {
  return (
    <nav aria-label="Administración" className="mb-8 flex flex-wrap gap-2">
      <NavLink to="/admin/usuarios" className={tab}>
        Usuarios
      </NavLink>
      <NavLink to="/admin/dlq" className={tab}>
        Cola de errores
      </NavLink>
    </nav>
  );
}
