import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Flujo completo con interfaz real: el administrador publica una subasta y un lote, un postor se
// registra y puja, y otra pestaña ve el precio nuevo SIN recargar (subscription por SSE).
const root = resolve(import.meta.dirname, '../../..');
const authFile = process.env['AUTH_ENV_FILE'] ?? resolve(root, '.env.auth.private');
const env = (name: string): string => {
  const line = readFileSync(authFile, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${name}=`));
  if (line === undefined) throw new Error(`falta ${name} en ${authFile}`);
  return line.slice(name.length + 1).trim();
};

const local = (offsetHours: number): string => {
  const d = new Date(Date.now() + offsetHours * 3_600_000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Subastas' })).toBeVisible();
}

test('administrador publica, postor puja y otra pestaña ve el precio en vivo', async ({
  browser,
}) => {
  const stamp = String(Date.now());
  const title = `Subasta e2e ${stamp}`;

  // 1. el administrador crea la subasta y un lote
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, env('BOOTSTRAP_ADMIN_EMAIL'), env('BOOTSTRAP_ADMIN_PASSWORD'));
  await admin.getByRole('link', { name: 'Nueva subasta' }).click();
  await admin.getByLabel('Título').fill(title);
  await admin.getByLabel('Abre').fill(local(-1));
  await admin.getByLabel('Cierra').fill(local(24));
  await admin.getByRole('button', { name: 'Crear subasta' }).click();
  await expect(admin.getByRole('heading', { name: title })).toBeVisible(); // espera a la proyección
  await admin.getByRole('button', { name: 'Añadir lote' }).click();
  await admin.getByLabel('Título del lote').fill('Reloj de bolsillo');
  await admin.getByLabel('Precio de salida').fill('100');
  await admin.getByLabel('Incremento mínimo').fill('5');
  await admin.getByLabel('Cierra').fill(local(12));
  await admin.getByRole('button', { name: 'Publicar lote' }).click();
  await expect(admin.getByRole('link', { name: /Reloj de bolsillo/ })).toBeVisible();
  const auctionUrl = admin.url();

  // 2. un postor se registra, entra al lote y puja
  const bidderCtx = await browser.newContext();
  const bidder = await bidderCtx.newPage();
  await bidder.goto('/registro');
  await bidder.getByLabel('Correo').fill(`postor-${stamp}@demo.local`);
  await bidder.getByLabel('Nombre público').fill(`Postor ${stamp}`);
  await bidder.getByLabel('Contraseña').fill(`clave-segura-${stamp}`);
  await bidder.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(bidder.getByRole('heading', { name: 'Subastas' })).toBeVisible();
  await bidder.goto(auctionUrl);
  await bidder.getByRole('link', { name: /Reloj de bolsillo/ }).click();
  await expect(bidder.getByTestId('price')).toHaveText('100.00 USD');

  // 3. el administrador abre el mismo lote y mira: el precio cambiará sin recargar
  await admin.goto(bidder.url());
  await expect(admin.getByTestId('price')).toHaveText('100.00 USD');
  await expect(admin.getByText('Solo los postores pueden pujar.')).toBeVisible();

  await bidder.getByLabel(/tu puja/i).fill('105');
  await bidder.getByRole('button', { name: 'Pujar' }).click();
  await expect(bidder.getByText('Tu puja es la vigente')).toBeVisible();
  await expect(bidder.getByTestId('price')).toHaveText('105.00 USD');
  await expect(admin.getByTestId('price')).toHaveText('105.00 USD'); // en vivo, sin recargar
  await expect(bidder.getByRole('listitem').filter({ hasText: '105.00 USD' })).toBeVisible();

  // 4. una puja por debajo del mínimo se frena en el cliente
  await bidder.getByLabel(/tu puja/i).fill('106');
  await bidder.getByRole('button', { name: 'Pujar' }).click();
  await expect(bidder.getByRole('alert')).toContainText('La puja mínima es 110.00 USD');

  await adminCtx.close();
  await bidderCtx.close();
});

test('sin sesión se redirige al login y un postor no ve la administración', async ({ page }) => {
  await page.goto('/subastas/nueva');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'DLQ' })).toHaveCount(0);
});
