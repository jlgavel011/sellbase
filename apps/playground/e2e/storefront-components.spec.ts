import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, DEMO_TOKEN, payWithWebhook, startCheckout, WEBHOOK_SECRET } from './store-helpers';

test.skip(!DEMO_TOKEN, 'Seed the demo store first: node scripts/seed-demo.mjs');

const tag = Date.now().toString(36);

/** Serious or critical accessibility problems on the current page. */
async function a11y(page: Page) {
  const { violations } = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test.describe.configure({ mode: 'serial' });

let hoodie: { id: string; slug: string; variants: { id: string; title: string }[] };

test.beforeAll(async () => {
  hoodie = await api<typeof hoodie>('POST', '/products', {
    type: 'physical',
    title: `Sudadera ${tag}`,
    status: 'active',
    description: 'Felpa suave.',
    options: [{ name: 'Talla', values: ['M', 'L'] }],
    variants: [
      { title: 'M', option_values: { Talla: 'M' }, price_amount: 59900, inventory: { on_hand: 5 } },
      { title: 'L', option_values: { Talla: 'L' }, price_amount: 64900, inventory: { on_hand: 0 } },
    ],
  });
  await api('POST', '/collections', { title: `Invierno ${tag}`, product_ids: [hoodie.id] });
  await api('POST', '/discounts', {
    code: `E2E${tag.toUpperCase()}`,
    kind: 'percent',
    value: 1000,
  });
});

test('home carousel and a collection page', async ({ page }) => {
  await page.goto('/');
  const carousel = page.getByRole('region', { name: 'Lo más nuevo' });
  await expect(carousel.getByRole('listitem').first()).toBeVisible();
  await carousel.getByRole('button', { name: 'Siguientes en Lo más nuevo' }).click();
  expect(await a11y(page)).toEqual([]);

  await page.goto(`/colecciones/invierno-${tag}`);
  await expect(page.getByRole('heading', { name: `Invierno ${tag}` })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(`Sudadera ${tag}`) })).toBeVisible();
});

test('variant picker, SEO data and the cart page with a discount', async ({ page }) => {
  await page.goto(`/productos/${hoodie.slug}`);
  await expect(page.getByRole('heading', { name: `Sudadera ${tag}` })).toBeVisible();

  // Search engines get Product/Offer data and Open Graph tags from the API.
  const ld = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) ?? '{}',
  );
  expect(ld).toMatchObject({
    '@type': 'Product',
    name: `Sudadera ${tag}`,
    offers: { '@type': 'AggregateOffer', lowPrice: '599.00' },
  });
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    'content',
    `Sudadera ${tag}`,
  );

  const sizes = page.getByRole('radiogroup', { name: 'Talla' });
  await expect(sizes.getByRole('radio', { name: 'L (agotado)' })).toBeVisible();
  await sizes.getByRole('radio', { name: 'M' }).focus();
  await page.keyboard.press('ArrowRight'); // keyboard moves to L
  await expect(sizes.getByRole('radio', { name: 'L (agotado)' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Agotado' })).toBeDisabled();
  await sizes.getByRole('radio', { name: 'M' }).click();
  await expect(page.getByText('$599.00').first()).toBeVisible();
  expect(await a11y(page)).toEqual([]);
  await page.getByRole('button', { name: 'Agregar al carrito' }).click();

  const drawer = page.getByRole('dialog', { name: 'Tu carrito' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Cerrar carrito' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  await page.goto('/carrito');
  await expect(page.getByRole('heading', { name: 'Tu carrito' })).toBeVisible();
  await page.getByRole('button', { name: `Agregar uno de Sudadera ${tag}` }).click();
  await expect(page.getByLabel(`Cantidad de Sudadera ${tag}`)).toHaveText('2');
  await page.getByLabel('Código de descuento').fill(`e2e${tag}`);
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText(`Código E2E${tag.toUpperCase()} aplicado`)).toBeVisible();
  await expect(page.getByText('Descuento', { exact: true })).toBeVisible();
  expect(await a11y(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/storefront-cart-page.png', fullPage: true });
  await page.getByRole('link', { name: 'Ir a pagar' }).click();
  await expect(page.getByRole('heading', { name: 'Pagar' })).toBeVisible();
  expect(await a11y(page)).toEqual([]);
});

test('return page: confirming until the webhook, then the order; then order lookup', async ({
  page,
}) => {
  test.skip(!WEBHOOK_SECRET, 'Needs STRIPE_WEBHOOK_SECRET to sign the payment webhook');
  const email = `e2e-${tag}@example.com`;
  const checkout = await startCheckout(hoodie.variants[0]?.id ?? '', email);
  expect(checkout.status).toBe('pending');

  // The buyer lands before Stripe's webhook: the page waits and says so.
  await page.goto(`/gracias?sellbase_checkout=${checkout.id}`);
  await expect(page.getByRole('status')).toHaveText('Confirmando tu pago…');
  expect(await a11y(page)).toEqual([]);

  await payWithWebhook(checkout.id, checkout.amount);
  await expect(page.getByText('¡Listo! Tu pago se confirmó.')).toBeVisible({ timeout: 15_000 });
  const number = (await page.getByText(/Pedido #\d+/).textContent())?.match(/#(\d+)/)?.[1] ?? '';
  await expect(page.getByText(`Sudadera ${tag}`)).toBeVisible();
  await page.screenshot({ path: 'test-results/storefront-return-paid.png', fullPage: true });

  // Later, "where is my order?" with the number and the email.
  await page.goto('/pedido');
  await page.getByLabel('Pedido').fill('999999');
  await page.getByLabel('Correo de la compra').fill(email);
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('No encontramos');
  await page.getByLabel('Pedido').fill(`#${number}`);
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText(`Pedido #${number}`)).toBeVisible();
  expect(await a11y(page)).toEqual([]);
});

test('download page explains invalid links, and the sitemap lists the catalog', async ({
  page,
  request,
}) => {
  await page.goto(`/descargas/${'x'.repeat(40)}`);
  await expect(page.getByRole('main').getByRole('alert')).toContainText('no es válido');

  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toContain(`/productos/${hoodie.slug}`);
  expect(sitemap).toContain(`/colecciones/invierno-${tag}`);
});
