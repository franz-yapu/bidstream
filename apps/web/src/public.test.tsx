import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from './api/client';
import { SessionStore, type Me } from './api/session';
import type { LotWithAuction } from './api/types';
import { ApiProvider } from './auth/context';
import { initials } from './components/Avatar';
import { safeReturn } from './pages/Entrar';
import { routes } from './routes';

const lot: LotWithAuction = {
  id: 'lot-1',
  title: 'Reloj de bolsillo',
  currency: 'USD',
  startingPrice: '100.00',
  minIncrement: '5.00',
  currentPrice: '120.00',
  closesAt: new Date(Date.now() + 3_600_000).toISOString(),
  status: 'OPEN',
  hasWinner: false,
  finalAmount: null,
  nextMinimumBid: '125.00',
  leader: { displayName: 'Ana Torres' },
  winner: null,
  auction: { id: 'a-1', title: 'Relojes antiguos' },
};

function setup(path: string, me: Me | null = null, overrides: Partial<Api> = {}) {
  const session = new SessionStore(() => Promise.reject(new Error('sin refresco')), null);
  session.setMe(me);
  const mocks = {
    register: vi.fn().mockResolvedValue(undefined),
    login: vi.fn().mockResolvedValue({}),
  };
  const api = {
    session,
    clock: { offsetMs: 0 },
    board: vi.fn().mockResolvedValue([]),
    listAuctions: vi.fn().mockResolvedValue({ items: [], hasNextPage: false, endCursor: null }),
    getLot: vi.fn().mockResolvedValue(lot),
    getBids: vi.fn().mockResolvedValue({
      items: [
        {
          id: 'b2',
          amount: '120.00',
          placedAt: new Date().toISOString(),
          rank: 1,
          awarded: false,
          bidder: { displayName: 'Ana Torres' },
        },
        {
          id: 'b1',
          amount: '110.00',
          placedAt: new Date().toISOString(),
          rank: 2,
          awarded: false,
          bidder: { displayName: 'Ben' },
        },
      ],
      hasNextPage: false,
      endCursor: null,
    }),
    subscribeLot: vi.fn().mockReturnValue(() => undefined),
    ...mocks,
    ...overrides,
  } as unknown as Api;
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ApiProvider api={api}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ApiProvider>,
  );
  return { api, router, mocks };
}

describe('sitio público (sin cuenta)', () => {
  it('el inicio se ve sin sesión, con el mensaje, el acceso y cómo funciona', async () => {
    setup('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: /Subastas en vivo/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cómo funciona' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Crear cuenta' }).length).toBeGreaterThan(0);
  });

  it('el listado de subastas es público', async () => {
    const { router } = setup('/subastas');
    expect(await screen.findByRole('heading', { name: 'Subastas' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/subastas');
    expect(await screen.findByText('Todavía no hay subastas.')).toBeInTheDocument();
  });

  it('el lote lo ve un espectador: líder, historial con nombres y la invitación a entrar', async () => {
    setup('/lotes/lot-1');
    expect(await screen.findByRole('heading', { name: 'Reloj de bolsillo' })).toBeInTheDocument();
    expect(screen.getByTestId('price')).toHaveTextContent('120.00 USD');
    expect(screen.getByTestId('countdown')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText('Ana Torres').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Ben')).toBeInTheDocument();
    expect(screen.getByText(/Va ganando/)).toBeInTheDocument();
    const enter = within(screen.getByRole('complementary')).getByRole('link', { name: 'Entrar' });
    expect(enter).toHaveAttribute('href', expect.stringContaining('volver=%2Flotes%2Flot-1'));
    expect(screen.queryByRole('form', { name: 'Pujar' })).toBeNull();
  });

  it('un postor con sesión ve el formulario de puja en el mismo lote', async () => {
    setup('/lotes/lot-1', {
      userId: 'u',
      tenantId: 't',
      role: 'BIDDER',
      email: 'p@demo.local',
      displayName: 'Pía',
    });
    expect(await screen.findByRole('form', { name: 'Pujar' })).toBeInTheDocument();
  });
});

describe('entrar y crear cuenta', () => {
  it('crear cuenta pide el nombre público, registra con él, entra y vuelve al lote', async () => {
    const user = userEvent.setup();
    const { mocks, router } = setup('/entrar?modo=registro&volver=%2Flotes%2Flot-1');
    // sin tenant por defecto (como en esta prueba) el campo aparece
    await user.type(
      await screen.findByLabelText(/Organización/),
      '11111111-1111-4111-8111-111111111111',
    );
    await user.type(screen.getByLabelText('Correo'), 'nuevo@demo.local');
    await user.type(screen.getByLabelText('Nombre público'), 'Nuevo Postor');
    await user.type(screen.getByLabelText('Contraseña'), 'una-clave-bastante-larga');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/lotes/lot-1');
    });
    expect(mocks.register).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'nuevo@demo.local',
      'una-clave-bastante-larga',
      'Nuevo Postor',
    );
    expect(mocks.login).toHaveBeenCalled();
  });

  it('entrar no pide el nombre público y valida el correo', async () => {
    const user = userEvent.setup();
    setup('/entrar');
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Nombre público')).toBeNull();
    await user.type(screen.getByLabelText('Correo'), 'no-es-correo');
    await user.type(screen.getByLabelText('Contraseña'), 'x');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Escribe un correo válido')).toBeInTheDocument();
  });

  it('mostrar la clave no la deja a la vista por defecto', async () => {
    const user = userEvent.setup();
    setup('/entrar');
    const field = await screen.findByLabelText('Contraseña');
    expect(field).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Mostrar clave' }));
    expect(field).toHaveAttribute('type', 'text');
  });

  it('/login y /registro siguen funcionando y redirigen', async () => {
    const { router } = setup('/registro');
    expect(await screen.findByRole('heading', { name: 'Crear cuenta' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/entrar');
  });
});

describe('utilidades', () => {
  it('solo se vuelve a rutas internas', () => {
    expect(safeReturn('/lotes/1')).toBe('/lotes/1');
    for (const bad of [null, '', '//evil.example', 'https://evil.example', 'javascript:alert(1)']) {
      expect(safeReturn(bad), String(bad)).toBe('/');
    }
  });

  it('las iniciales salen del nombre público', () => {
    expect(initials('Ana Torres')).toBe('AT');
    expect(initials('ben')).toBe('B');
    expect(initials('  ')).toBe('?');
  });
});
