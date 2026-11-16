import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../api/client';
import { ApiError } from '../api/http';
import type { LotWithAuction } from '../api/types';
import { ApiProvider } from '../auth/context';
import { BidForm, CONFIRMATION_WAIT_MS } from './BidForm';

const lot: LotWithAuction = {
  id: 'l1',
  title: 'Lote',
  currency: 'USD',
  startingPrice: '100.00',
  minIncrement: '5.00',
  currentPrice: null,
  closesAt: '2030-01-01T10:00:00.000Z',
  status: 'OPEN',
  hasWinner: false,
  finalAmount: null,
  nextMinimumBid: '100.00',
  auction: null,
};

function setup(placeBid: Api['placeBid'], current: LotWithAuction = lot, closed = false) {
  const api = { placeBid } as unknown as Api;
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const ui = (l: LotWithAuction) => (
    <ApiProvider api={api}>
      <QueryClientProvider client={client}>
        <BidForm lot={l} closed={closed} />
      </QueryClientProvider>
    </ApiProvider>
  );
  const view = render(ui(current));
  return {
    rerender: (l: LotWithAuction) => {
      view.rerender(ui(l));
    },
  };
}

describe('BidForm', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rechaza en el cliente un importe inválido o por debajo del mínimo, sin llamar a la API', async () => {
    const placeBid = vi.fn();
    setup(placeBid);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/tu puja/i), '99');
    await user.click(screen.getByRole('button', { name: 'Pujar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La puja mínima es 100.00 USD');
    await user.clear(screen.getByLabelText(/tu puja/i));
    await user.type(screen.getByLabelText(/tu puja/i), 'abc');
    await user.click(screen.getByRole('button', { name: 'Pujar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('importe válido');
    expect(placeBid).not.toHaveBeenCalled();
  });

  it('reintenta con la MISMA Idempotency-Key tras un fallo y usa una nueva en la puja siguiente', async () => {
    const placeBid = vi
      .fn<Api['placeBid']>()
      .mockRejectedValueOnce(new TypeError('red caída'))
      .mockResolvedValue({ commandId: 'c' });
    setup(placeBid);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/tu puja/i), '105,5');
    await user.click(screen.getByRole('button', { name: 'Pujar' }));
    await screen.findByText(/No se pudo conectar/);
    await user.click(screen.getByRole('button', { name: 'Pujar' }));
    await screen.findByText(/Esperando confirmación/);
    const [first, second] = placeBid.mock.calls;
    expect(first?.[1]).toBe('105.50');
    expect(second?.[2]).toBe(first?.[2]); // misma clave en el reintento

    await user.clear(screen.getByLabelText(/tu puja/i));
    await user.type(screen.getByLabelText(/tu puja/i), '105,5');
    await user.click(screen.getByRole('button', { name: 'Pujar' }));
    await waitFor(() => {
      expect(placeBid).toHaveBeenCalledTimes(3);
    });
    expect(placeBid.mock.calls[2]?.[2]).not.toBe(first?.[2]); // puja nueva → clave nueva
  });

  it('muestra el aviso de límite con el tiempo de espera cuando la API responde 429', async () => {
    setup(vi.fn().mockRejectedValue(new ApiError(429, 'Too Many Requests', undefined, [], 12)));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/tu puja/i), '100');
    await user.click(screen.getByRole('button', { name: 'Pujar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reintenta en 12 s');
  });

  it('confirma al ver el precio vigente igual a la puja y avisa si pasa el tiempo sin confirmación', async () => {
    const placeBid = vi.fn().mockResolvedValue({ commandId: 'c' });
    const { rerender } = setup(placeBid);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/tu puja/i), '100');
    await user.click(screen.getByRole('button', { name: 'Pujar' }));
    await screen.findByText(/Esperando confirmación/);
    rerender({ ...lot, currentPrice: '100.00', nextMinimumBid: '105.00' });
    expect(await screen.findByText(/es la vigente/)).toBeInTheDocument();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await user.clear(screen.getByLabelText(/tu puja/i));
    await user.type(screen.getByLabelText(/tu puja/i), '105');
    await user.click(screen.getByRole('button', { name: 'Pujar' }));
    await screen.findByText(/Esperando confirmación/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFIRMATION_WAIT_MS + 100);
    });
    expect(await screen.findByText(/no quedó como vigente/)).toBeInTheDocument();
  });

  it('con el lote cerrado deshabilita el formulario', () => {
    setup(vi.fn(), lot, true);
    expect(screen.getByRole('button', { name: 'Lote cerrado' })).toBeDisabled();
    expect(screen.getByLabelText(/tu puja/i)).toBeDisabled();
  });
});
