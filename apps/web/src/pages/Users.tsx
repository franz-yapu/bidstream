import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AdminUser } from '../api/types';
import { useApi } from '../auth/context';
import { AdminTabs } from '../components/AdminTabs';
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import { ErrorNote } from '../components/ErrorNote';
import { usePageTitle } from '../lib/page-title';

const ROLE: Record<AdminUser['role'], string> = {
  ADMIN: 'Administrador',
  SELLER: 'Vendedor',
  BIDDER: 'Postor',
};

export function UsersPage() {
  usePageTitle('Usuarios');
  const api = useApi();
  const [filter, setFilter] = useState('');
  const query = useQuery({ queryKey: ['admin-users'], queryFn: () => api.listUsers() });
  const needle = filter.trim().toLowerCase();
  const users = (query.data ?? []).filter(
    (u) => needle === '' || `${u.displayName} ${u.email}`.toLowerCase().includes(needle),
  );

  return (
    <section className="pt-6">
      <AdminTabs />
      <h1 className="text-5xl">Usuarios</h1>
      <p className="mt-3 mb-8 max-w-2xl text-ink-soft">
        El nombre público es lo que todos ven en las pujas. Si alguno es inadecuado, cámbialo aquí;
        el usuario verá el nuevo nombre en su próxima visita.
      </p>
      <div className="mb-6 max-w-sm">
        <label htmlFor="user-filter" className="label">
          Buscar por nombre o correo
        </label>
        <input
          id="user-filter"
          type="search"
          className="field"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
          }}
        />
      </div>
      {query.isPending && <p role="status">Cargando…</p>}
      <ErrorNote error={query.error} />
      {query.isSuccess && users.length === 0 && <EmptyState title="Ningún usuario coincide" />}
      <ul className="space-y-3">
        {users.map((user) => (
          <UserRow key={user.userId} user={user} />
        ))}
      </ul>
    </section>
  );
}

function UserRow({ user }: { user: AdminUser }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(user.displayName);
  const rename = useMutation({
    mutationFn: () => api.renameUser(user.userId, value),
    onSuccess: async () => {
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });
  const inputId = `rename-${user.userId}`;

  return (
    <li className="card">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={user.displayName} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-medium">{user.displayName}</p>
          <p className="truncate text-[15px] text-ink-soft">
            {user.email} · {ROLE[user.role]}
            {user.status === 'DISABLED' ? ' · Deshabilitado' : ''}
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            className="btn-secondary"
            aria-label={`Cambiar nombre de ${user.displayName}`}
            onClick={() => {
              setValue(user.displayName);
              rename.reset();
              setEditing(true);
            }}
          >
            Cambiar nombre
          </button>
        )}
      </div>
      {editing && (
        <form
          noValidate
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            rename.mutate();
          }}
        >
          <div className="min-w-60 flex-1">
            <label htmlFor={inputId} className="label">
              Nuevo nombre público
            </label>
            <input
              id={inputId}
              className="field"
              value={value}
              autoFocus
              onChange={(e) => {
                setValue(e.target.value);
              }}
            />
          </div>
          <button type="submit" className="btn" disabled={rename.isPending}>
            {rename.isPending ? 'Guardando…' : 'Guardar'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setEditing(false);
            }}
          >
            Cancelar
          </button>
          <div className="basis-full">
            <ErrorNote error={rename.error} />
          </div>
        </form>
      )}
    </li>
  );
}
