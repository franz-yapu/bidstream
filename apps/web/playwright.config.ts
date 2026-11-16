import { defineConfig, devices } from '@playwright/test';

// E2E contra el sistema levantado con `make demo` (front en :8080). No arranca nada por su cuenta.
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env['WEB_URL'] ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'es',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
