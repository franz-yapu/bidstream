import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from './api/client';
import { SessionStore } from './api/session';
import type { Bid, LotWithAuction } from './api/types';
import { ApiProvider } from './auth/context';
import { BidForm } from './components/BidForm';
import { hashOf, LotCover } from './components/LotCover';
import { YourStatus } from './components/YourStatus';
import { routes } from './routes';

const bid = (id: string, amount: string, name: string, rank: number): Bid => ({
  id,
  amount,
  rank,
  placedAt: '2026-11-16T10:00:00.000Z',
  awarded: false,
  bidder: { displayName: name },
});

describe('portada del lote', () => {
  it('es siempre la misma para el mismo lote y varía entre lotes', () => {
    const html = (seed: string): string => render(<LotCover seed={seed} />).container.innerHTML;
    expect(html('lote-a')).toBe(html('lote-a'));
    const covers = new Set(Array.from({ length: 12 }, (_, i) => html(`lote-${String(i)}`)));
    expect(covers.size).toBeGreaterThan(3);
    expect(hashOf('x')).toBe(hashOf('x'));
  });

  it('es decorativa: no se anuncia a lectores de pantalla', () => {
    render(<LotCover seed="a" />);
    expect(screen.getByTestId('lot-cover')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('estado del postor en el lote', () => {
  const props = { currency: 'USD', nextMinimum: '125.00', closed: false } as const;

  it('no dice nada si aún no ha pujado', () => {
    const { container } = render(
      <YourStatus {...props} me="Pía" bids={[bid('1', '120.00', 'Ana', 1)]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('avisa cuando va ganando', () => {
    render(<YourStatus {...props} me="Pía" bids={[bid('1', '120.00', 'Pía', 1)]} />);
    expect(screen.getByRole('status')).toHaveTextContent('Vas ganando con 120.00 USD');
  });

  it('avisa cuando lo superan y cuánto debe pujar', () => {
    render(
      <YourStatus
        {...props}
        me="Pía"
        bids={[bid('2', '120.00', 'Ana', 1), bid('1', '110.00', 'Pía', 2)]}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Te han superado');
    expect(screen.getByRole('status')).toHaveTextContent('al menos 125.00 USD');
  });

  it('con el lote cerrado dice si ganó', () => {
    render(<YourStatus {...props} closed me="Pía" bids={[bid('1', '120.00', 'Pía', 1)]} />);
    expect(screen.getByRole('status')).toHaveTextContent('Ganaste este lote');
  });
});

describe('puja rápida', () => {
  const lot: LotWithAuction = {
    id: 'l1',
    title: 'Lote',
    currency: 'USD',
    startingPrice: '100.00',
    minIncrement: '5.00',
    currentPrice: '120.00',
    closesAt: '2030-01-01T10:00:00.000Z',
    status: 'OPEN',
    hasWinner: false,
    finalAmount: null,
    nextMinimumBid: '125.00',
    auction: null,
  };

  it('ofrece el mínimo y saltos de incremento, y rellena el campo sin enviar nada', async () => {
    const user = userEvent.setup();
    const placeBid = vi.fn();
    const api = { placeBid } as unknown as Api;
    render(
      <ApiProvider api={api}>
        <QueryClientProvider client={new QueryClient()}>
          <BidForm lot={lot} closed={false} />
        </QueryClientProvider>
      </ApiProvider>,
    );
    const chips = screen.getByRole('group', { name: 'Importes rápidos' });
    expect(chips.textContent).toBe('125.00130.00140.00175.00'); // mínimo, +1, +3 y +10 incrementos
    await user.click(screen.getByRole('button', { name: 'Usar 140.00 USD' }));
    expect(screen.getByLabelText(/tu puja/i)).toHaveValue('140.00');
    expect(placeBid).not.toHaveBeenCalled();
  });

  it('con el lote cerrado no hay atajos', () => {
    const api = { placeBid: vi.fn() } as unknown as Api;
    render(
      <ApiProvider api={api}>
        <QueryClientProvider client={new QueryClient()}>
          <BidForm lot={lot} closed />
        </QueryClientProvider>
      </ApiProvider>,
    );
    expect(screen.queryByRole('group', { name: 'Importes rápidos' })).toBeNull();
  });
});

describe('menú móvil', () => {
  it('se abre y se cierra y ofrece la navegación y el acceso', async () => {
    const user = userEvent.setup();
    const session = new SessionStore(() => Promise.reject(new Error('sin refresco')), null);
    const api = {
      session,
      clock: { offsetMs: 0 },
      board: vi.fn().mockResolvedValue([]),
    } as unknown as Api;
    const router = createMemoryRouter(routes, { initialEntries: ['/'] });
    render(
      <ApiProvider api={api}>
        <QueryClientProvider client={new QueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ApiProvider>,
    );
    const toggle = screen.getByRole('button', { name: 'Menú' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'Principal (móvil)' })).toBeNull();
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('navigation', { name: 'Principal (móvil)' });
    await user.click(menu.querySelector('a[href="/subastas"]') as HTMLElement);
    expect(router.state.location.pathname).toBe('/subastas');
    expect(screen.queryByRole('navigation', { name: 'Principal (móvil)' })).toBeNull();
  });
});
