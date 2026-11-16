import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Pruebas con jsdom; el resto del repositorio usa el entorno `node` (vitest.config.ts de la raíz).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  // Sin inlinar recursos: la CSP no admite `data:` en `font-src` y las tipografías se sirven desde el propio sitio.
  build: {
    sourcemap: false,
    target: 'es2023',
    assetsInlineLimit: 0,
    // Las librerías cambian poco: en trozos aparte se cachean entre versiones de la aplicación.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/,
            },
            { name: 'query', test: /node_modules[\\/]@tanstack[\\/]/ },
            { name: 'forms', test: /node_modules[\\/](react-hook-form|@hookform|zod)[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
    css: false,
  },
});
