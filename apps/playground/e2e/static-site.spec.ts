import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createOwner, SERVICE_KEY, signIn } from './admin-helpers';
import { api, DEMO_TOKEN, payWithWebhook, startCheckout, WEBHOOK_SECRET } from './store-helpers';

/**
 * Sellbase in a plain HTML site (no React, no build): <sellbase-*> web components and the
 * static admin. The page has a careless global `button { background: hotpink }` that must
 * not leak into the Sellbase elements (Shadow DOM).
 */
const SITE = 'http://localhost:3200';
test.skip(!DEMO_TOKEN, 'Seed the demo store first: node scripts/seed-demo.mjs');

async function a11y(page: Page) {
  const { violations } = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => v.id);
}

test('add to cart, drawer and checkout in a plain HTML page', async ({ page }) => {
  await page.goto(`${SITE}/`);
  const buy = page.locator('sellbase-add-to-cart');
  await expect(buy.getByText('$349.00')).toBeVisible();
  const add = buy.getByRole('button', { name: 'Agregar al carrito' });
  // The theme comes from the page's CSS variables, not from its global button rule.
  await expect(add).toHaveCSS('background-color', 'rgb(24, 27, 60)');
  await expect(page.locator('sellbase-product-grid').getByRole('link').first()).toBeVisible();
  expect(await a11y(page)).toEqual([]);

  await add.click();
  const drawer = page.getByRole('dialog', { name: 'Tu carrito' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Playera Sellbase')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Carrito, 1 artículo' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Cerrar' })).toBeFocused();
  await drawer.getByRole('button', { name: 'Agregar uno de Playera Sellbase' }).click();
  await expect(drawer.getByLabel('Cantidad de Playera Sellbase')).toHaveText('2');
  await drawer.getByRole('link', { name: 'Ir a pagar' }).click();

  await expect(page).toHaveURL(/checkout\.html/);
  const form = page.locator('sellbase-checkout');
  await form.getByLabel('Correo electrónico').fill('html-e2e@example.com');
  await form.getByLabel('Nombre').fill('Ana');
  await form.getByLabel('Calle y número').fill('Av. Reforma 222');
  await form.getByLabel('Ciudad').fill('CDMX');
  await form.getByLabel('Estado').fill('CDMX');
  await form.getByLabel('Código postal').fill('06600');
  await expect(form.getByRole('radio').first()).toBeChecked();
  const pay = form.getByRole('button', { name: 'Pagar' });
  await expect(pay).toBeDisabled(); // the 18+ confirmation is required
  await form.getByLabel('Confirmo que soy mayor de 18 años').check();
  await expect(pay).toBeEnabled();
  expect(await a11y(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/static-checkout.png', fullPage: true });
  await pay.click();
  const outcome = await Promise.race([
    page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 }).then(
      () => 'stripe',
      () => 'timeout',
    ),
    form
      .getByRole('alert')
      .waitFor({ timeout: 30_000 })
      .then(
        () => 'no-payments',
        () => 'timeout',
      ),
  ]);
  expect(['stripe', 'no-payments']).toContain(outcome);
});

test('return page and order lookup in plain HTML', async ({ page }) => {
  test.skip(!WEBHOOK_SECRET, 'Needs STRIPE_WEBHOOK_SECRET to sign the payment webhook');
  const product = await api<{ variants: { id: string }[] }>(
    'GET',
    '/storefront/products/playera-sellbase',
    undefined,
    false,
  );
  const email = `html-${Date.now()}@example.com`;
  const checkout = await startCheckout(product.variants[0]?.id ?? '', email);
  await page.goto(`${SITE}/gracias.html?sellbase_checkout=${checkout.id}`);
  await expect(page.getByRole('status')).toContainText('Confirmando tu pago…');
  await payWithWebhook(checkout.id, checkout.amount);
  await expect(page.getByText('¡Listo! Tu pago se confirmó.')).toBeVisible({ timeout: 15_000 });
  const number = (await page.getByText(/Pedido #\d+/).textContent())?.match(/#(\d+)/)?.[1] ?? '';

  await page.goto(`${SITE}/pedido.html`);
  await page.getByLabel('Pedido').fill(number);
  await page.getByLabel('Correo de la compra').fill(email);
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText(`Pedido #${number}`)).toBeVisible();
});

test('the static admin works on a plain host with #/ routes', async ({ page }) => {
  test.skip(!SERVICE_KEY, 'Needs SUPABASE_SERVICE_ROLE_KEY to create the staff user');
  const { email, password } = await createOwner();
  await page.goto(`${SITE}/admin/`);
  await signIn(page, email, password, `${SITE}/admin/`);
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Admin' })
    .getByRole('link', { name: /Pedidos/ })
    .click();
  await expect(page).toHaveURL(/\/admin\/#\/orders$/);
  await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();
  await page.reload(); // deep link survives a reload without server rewrites
  await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();
});
