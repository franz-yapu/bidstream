import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from './api/client';
import { SessionStore } from './api/session';
import type { AuctionWithLiveLots, Lot } from './api/types';
import { ApiProvider } from './auth/context';
import { sortLots, summarizeLots } from './lib/lots';
import { routes } from './routes';

const lot = (
  id: string,
  title: string,
  price: string,
  closesAt: string,
  over?: Partial<Lot>,
): Lot => ({
  id,
  title,
  currency: 'USD',
  startingPrice: '10.00',
  minIncrement: '5.00',
  currentPrice: price,
  closesAt,
  status: 'OPEN',
  hasWinner: false,
  finalAmount: null,
  nextMinimumBid: '999.00',
  leader: null,
  winner: null,
  ...over,
});

const A = lot('a', 'Reloj', '300.00', '2030-01-03T10:00:00.000Z');
const B = lot('b', 'Cuadro', '120.00', '2030-01-01T10:00:00.000Z');
const C = lot('c', 'Jarrón', '900.00', '2030-01-02T10:00:00.000Z');

describe('orden de lotes', () => {
  it('ordena por cierre y por precio sin tocar la lista original', () => {
    const lots = [A, B, C];
    expect(sortLots(lots, 'closing').map((l) => l.id)).toEqual(['b', 'c', 'a']);
    expect(sortLots(lots, 'priceAsc').map((l) => l.id)).toEqual(['b', 'a', 'c']);
    expect(sortLots(lots, 'priceDesc').map((l) => l.id)).toEqual(['c', 'a', 'b']);
    expect(lots.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('resume una subasta: lotes, abiertos, próximo cierre y precio más alto', () => {
    const closed = lot('d', 'Viejo', '50.00', '2029-01-01T00:00:00.000Z', { status: 'CLOSED' });
    expect(summarizeLots([A, B, C, closed])).toEqual({
      total: 4,
      open: 3,
      nextClose: '2030-01-01T10:00:00.000Z',
      topPrice: '900.00 USD',
    });
    expect(summarizeLots([])).toMatchObject({ total: 0, nextClose: null, topPrice: null });
  });
});

function setup(path: string, api: Partial<Api>) {
  const session = new SessionStore(() => Promise.reject(new Error('sin refresco')), null);
  const full = { session, clock: { offsetMs: 0 }, ...api } as unknown as Api;
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ApiProvider api={full}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ApiProvider>,
  );
  return router;
}

const auction = (lots: Lot[]): AuctionWithLiveLots => ({
  id: 'au1',
  title: 'Subasta de otoño',
  opensAt: '2020-01-01T00:00:00.000Z',
  closesAt: '2030-01-05T00:00:00.000Z',
  status: 'OPEN',
  lots,
});

describe('todos los lotes', () => {
  it('lista los lotes abiertos y cambia el orden', async () => {
    const user = userEvent.setup();
    setup('/lotes', {
      board: vi.fn((status: string) =>
        Promise.resolve(status === 'OPEN' ? [auction([A, B, C])] : []),
      ),
    });
    const titles = (): string[] =>
      screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    await waitFor(() => {
      expect(titles()).toEqual(['Cuadro', 'Jarrón', 'Reloj']);
    });
    expect(document.title).toBe('Todos los lotes · bidstream');
    await user.selectOptions(screen.getByLabelText('Ordenar por'), 'priceDesc');
    expect(titles()).toEqual(['Jarrón', 'Reloj', 'Cuadro']);
  });

  it('avisa cuando no hay lotes abiertos', async () => {
    setup('/lotes', { board: vi.fn().mockResolvedValue([]) });
    expect(await screen.findByText('Todavía no hay lotes')).toBeInTheDocument();
  });
});

describe('listado de subastas con más información', () => {
  it('muestra lotes, precio más alto y próximo cierre', async () => {
    const user = userEvent.setup();
    setup('/subastas', {
      listAuctions: vi.fn().mockResolvedValue({
        items: [{ ...auction([]), lots: [A, B, C] }],
        hasNextPage: false,
        endCursor: null,
      }),
    });
    const card = (await screen.findByRole('heading', { name: 'Subasta de otoño' })).closest('a');
    expect(card).not.toBeNull();
    const view = within(card as HTMLElement);
    expect(view.getByText('3')).toBeInTheDocument();
    expect(view.getByText('En proceso')).toBeInTheDocument();
    expect(view.getByText('900.00 USD')).toBeInTheDocument();
    expect(view.getByText('Próximo cierre')).toBeInTheDocument();
    expect(document.title).toBe('Subastas · bidstream');
    await user.click(screen.getByRole('tab', { name: 'Terminadas' }));
  });
});

describe('página no encontrada', () => {
  it('muestra un 404 con salidas, no redirige', () => {
    const router = setup('/no-existe', { board: vi.fn().mockResolvedValue([]) });
    expect(screen.getByRole('heading', { name: 'Esta página no existe' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir al inicio' })).toHaveAttribute('href', '/');
    expect(router.state.location.pathname).toBe('/no-existe');
    expect(document.title).toBe('Página no encontrada · bidstream');
  });
});

describe('copiar enlace', () => {
  it('copia la dirección de la página y lo confirma', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    setup('/subastas/au1', {
      getAuction: vi.fn().mockResolvedValue({ ...auction([A]), lots: [A] }),
    });
    await user.click(await screen.findByRole('button', { name: 'Copiar enlace' }));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(await screen.findByText('Enlace copiado')).toBeInTheDocument();
    expect(document.title).toBe('Subasta de otoño · bidstream');
  });
});

describe('estado y pujas a la vista', () => {
  const D = lot('d', 'Viejo', '50.00', '2029-01-01T00:00:00.000Z', {
    status: 'CLOSED',
    finalAmount: '50.00',
    hasWinner: true,
    winner: { displayName: 'Ana' },
  });
  const bids = {
    items: [
      {
        id: 'x',
        amount: '300.00',
        placedAt: '2026-11-16T10:00:00.000Z',
        rank: 1,
        awarded: false,
        bidder: { displayName: 'Luz' },
      },
    ],
    hasNextPage: false,
    endCursor: null,
  };

  it('separa lo que está en proceso de lo que terminó, cada bloque con su cuenta', async () => {
    setup('/lotes', {
      board: vi.fn((status: string) =>
        Promise.resolve(
          status === 'OPEN' ? [auction([A, B])] : [{ ...auction([D]), status: 'CLOSED' as const }],
        ),
      ),
    });
    const live = await screen.findByRole('region', { name: /En proceso/ });
    const done = screen.getByRole('region', { name: /Terminados/ });
    expect(within(live).getAllByRole('heading', { level: 3 })).toHaveLength(2);
    expect(within(done).getByRole('heading', { level: 3, name: 'Viejo' })).toBeInTheDocument();
    expect(within(done).getByText('Terminado')).toBeInTheDocument();
    expect(within(live).getAllByText('En proceso').length).toBeGreaterThan(0);
  });

  it('muestra las pujas de un lote sin entrar en él, y de todos con el interruptor', async () => {
    const user = userEvent.setup();
    const getBids = vi.fn().mockResolvedValue(bids);
    setup('/lotes', {
      board: vi.fn((status: string) => Promise.resolve(status === 'OPEN' ? [auction([A, B])] : [])),
      getBids,
    });
    const buttons = await screen.findAllByRole('button', { name: 'Ver pujas' });
    await user.click(buttons[0] as HTMLElement);
    expect(await screen.findByRole('list', { name: 'Pujas del lote' })).toHaveTextContent('Luz');
    expect(getBids).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('switch', { name: 'Mostrar pujas' }));
    expect(await screen.findAllByRole('list', { name: 'Pujas del lote' })).toHaveLength(2);
  });
});
