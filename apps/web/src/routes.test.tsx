import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Api } from './api/client';
import { SessionStore, type Me } from './api/session';
import { ApiProvider } from './auth/context';
import { routes } from './routes';

function renderAt(path: string, me: Me | null) {
  const session = new SessionStore(() => Promise.reject(new Error('sin refresco')), null);
  session.setMe(me);
  const api = { session } as unknown as Api;
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ApiProvider api={api}>
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ApiProvider>,
  );
  return router;
}
const user = (role: Me['role']): Me => ({
  userId: 'u',
  tenantId: 't',
  role,
  email: `${role}@demo.local`,
});

describe('rutas protegidas por rol', () => {
  it('sin sesión se va al login', async () => {
    const router = renderAt('/subastas/nueva', null);
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('un postor no ve crear subasta ni el DLQ, y su menú no los ofrece', async () => {
    renderAt('/subastas/nueva', user('BIDDER'));
    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso');
    expect(screen.queryByRole('link', { name: 'Nueva subasta' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'DLQ' })).toBeNull();
  });

  it('el administrador ve crear subasta y el DLQ en el menú', async () => {
    renderAt('/subastas/nueva', user('ADMIN'));
    expect(await screen.findByRole('heading', { name: 'Nueva subasta' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'DLQ' })).toBeInTheDocument();
  });

  it('el DLQ es solo del administrador: un vendedor recibe el aviso', async () => {
    renderAt('/admin/dlq', user('SELLER'));
    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso');
  });
});
