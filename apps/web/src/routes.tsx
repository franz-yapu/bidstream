import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { CREATOR_ROLES, RequireRole } from './auth/context';
import { Layout } from './components/Layout';
import { AccountPage } from './pages/Account';
import { AuctionDetailPage } from './pages/AuctionDetail';
import { AuctionsPage } from './pages/Auctions';
import { DlqPage } from './pages/Dlq';
import { EntrarPage } from './pages/Entrar';
import { HomePage } from './pages/Home';
import { LotPage } from './pages/LotPage';
import { NewAuctionPage } from './pages/NewAuction';

// Públicas (sin cuenta, solo lectura): inicio, subastas, subasta, lote y entrar. El resto exige sesión;
// la interfaz solo oculta lo que el backend ya deniega.
export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/entrar', element: <EntrarPage /> },
      { path: '/login', element: <Navigate to="/entrar" replace /> },
      { path: '/registro', element: <Navigate to="/entrar?modo=registro" replace /> },
      { path: '/subastas', element: <AuctionsPage /> },
      {
        path: '/subastas/nueva',
        element: (
          <RequireRole roles={CREATOR_ROLES}>
            <NewAuctionPage />
          </RequireRole>
        ),
      },
      { path: '/subastas/:auctionId', element: <AuctionDetailPage /> },
      { path: '/lotes/:lotId', element: <LotPage /> },
      {
        path: '/cuenta',
        element: (
          <RequireRole>
            <AccountPage />
          </RequireRole>
        ),
      },
      {
        path: '/admin/dlq',
        element: (
          <RequireRole roles={['ADMIN']}>
            <DlqPage />
          </RequireRole>
        ),
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
