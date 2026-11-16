import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { CREATOR_ROLES, RequireRole } from './auth/context';
import { Layout } from './components/Layout';
import { AuctionDetailPage } from './pages/AuctionDetail';
import { AuctionsPage } from './pages/Auctions';
import { DlqPage } from './pages/Dlq';
import { LoginPage } from './pages/Login';
import { LotPage } from './pages/LotPage';
import { NewAuctionPage } from './pages/NewAuction';
import { RegisterPage } from './pages/Register';

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/registro', element: <RegisterPage /> },
      {
        path: '/',
        element: (
          <RequireRole>
            <AuctionsPage />
          </RequireRole>
        ),
      },
      {
        path: '/subastas/nueva',
        element: (
          <RequireRole roles={CREATOR_ROLES}>
            <NewAuctionPage />
          </RequireRole>
        ),
      },
      {
        path: '/subastas/:auctionId',
        element: (
          <RequireRole>
            <AuctionDetailPage />
          </RequireRole>
        ),
      },
      {
        path: '/lotes/:lotId',
        element: (
          <RequireRole>
            <LotPage />
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
