import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { createApi } from './api/client';
import { ApiProvider, SessionBootstrap } from './auth/context';
import { loadConfig } from './config';
import { createRouter } from './routes';
import './styles.css';

const api = createApi(loadConfig());
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
const router = createRouter();

const root = document.getElementById('root');
if (root === null) throw new Error('falta #root');
createRoot(root).render(
  <StrictMode>
    <ApiProvider api={api}>
      <QueryClientProvider client={queryClient}>
        <SessionBootstrap>
          <RouterProvider router={router} />
        </SessionBootstrap>
      </QueryClientProvider>
    </ApiProvider>
  </StrictMode>,
);
