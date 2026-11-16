import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Pruebas con jsdom; el resto del repositorio usa el entorno `node` (vitest.config.ts de la raíz).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  // Sin inlinar recursos: la CSP no admite `data:` en `font-src` y las tipografías se sirven desde el propio sitio.
  build: { sourcemap: false, target: 'es2023', assetsInlineLimit: 0 },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
    css: false,
  },
});
