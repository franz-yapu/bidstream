import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Revisión automática de accesibilidad (axe, en un navegador real: incluye el contraste de color).
// Con movimiento reducido: así axe no mide el contraste en mitad de una animación de entrada.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

// Falla ante cualquier problema; lo que axe no puede decidir sin una persona queda fuera de aquí.
const PAGES = ['/', '/subastas', '/lotes', '/entrar', '/entrar?modo=registro', '/no-existe'];

for (const path of PAGES) {
  test(`accesibilidad: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    expect(
      result.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
      ),
    ).toEqual([]);
  });
}

test('accesibilidad: una subasta y un lote con las pujas abiertas', async ({ page }) => {
  await page.goto('/lotes');
  await page.getByRole('switch', { name: 'Mostrar pujas' }).check({ force: true });
  await page.waitForLoadState('networkidle');
  const lotLink = page.locator('a[href^="/lotes/"]').first();
  const lotUrl = await lotLink.getAttribute('href');
  const first = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  expect(first.violations.map((v) => v.id)).toEqual([]);
  await page.goto(lotUrl ?? '/lotes');
  // la página del lote mantiene abierto un flujo en vivo: no llega a «red inactiva»
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Historial de pujas' })).toBeVisible();
  const second = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  expect(
    second.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
});

// Con la base vacía (como en CI) el inicio muestra los estados vacíos: también deben ser legibles.
test('accesibilidad: el inicio sin subastas', async ({ page }) => {
  await page.route('**/graphql', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { auctions: { edges: [] } } }),
    }),
  );
  await page.goto('/');
  await expect(page.getByText('Ahora mismo no hay lotes en curso')).toBeVisible();
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  expect(
    result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
});
