import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from './api/client';
import { SessionStore } from './api/session';
import { ApiError } from './api/http';
import type { AdminUser } from './api/types';
import { ApiProvider } from './auth/context';
import { routes } from './routes';

const users: AdminUser[] = [
  { userId: 'u1', email: 'ana@x.com', displayName: 'Ana', role: 'BIDDER', status: 'ACTIVE' },
  { userId: 'u2', email: 'bob@x.com', displayName: 'Bob', role: 'SELLER', status: 'ACTIVE' },
];

function setup(api: Partial<Api>) {
  const session = new SessionStore(() => Promise.reject(new Error('sin refresco')), null);
  session.setMe({
    userId: 'a',
    tenantId: 't',
    role: 'ADMIN',
    email: 'admin@x.com',
    displayName: 'Admin',
  });
  const router = createMemoryRouter(routes, { initialEntries: ['/admin/usuarios'] });
  render(
    <ApiProvider api={{ session, clock: { offsetMs: 0 }, ...api } as unknown as Api}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ApiProvider>,
  );
}

describe('administración de usuarios', () => {
  it('lista, filtra y renombra a un usuario', async () => {
    const user = userEvent.setup();
    const renameUser = vi.fn().mockResolvedValue('Nombre nuevo');
    setup({ listUsers: vi.fn().mockResolvedValue(users), renameUser });
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Buscar por nombre o correo'), 'bob@');
    expect(screen.queryByText('Ana')).toBeNull();
    await user.clear(screen.getByLabelText('Buscar por nombre o correo'));
    await user.click(screen.getByRole('button', { name: 'Cambiar nombre de Ana' }));
    const field = screen.getByLabelText('Nuevo nombre público');
    await user.clear(field);
    await user.type(field, 'Nombre nuevo');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(renameUser).toHaveBeenCalledWith('u1', 'Nombre nuevo');
  });

  it('muestra el motivo si el nombre ya está en uso', async () => {
    const user = userEvent.setup();
    const renameUser = vi
      .fn()
      .mockRejectedValue(
        new ApiError(409, 'Conflicto', 'Ese nombre público ya está en uso. Elija otro.'),
      );
    setup({ listUsers: vi.fn().mockResolvedValue(users), renameUser });
    await user.click(await screen.findByRole('button', { name: 'Cambiar nombre de Ana' }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ya está en uso');
  });
});
