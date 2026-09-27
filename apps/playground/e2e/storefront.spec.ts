import { expect, test } from '@playwright/test';

/**
 * Storefront against the local stack (supabase start + the demo store with a physical and
 * a digital product and Stripe connected). Ends at the Stripe Checkout redirect; paying
 * is covered by the purchase spec.
 */
test('browse, add to cart, and reach Stripe Checkout', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Productos' })).toBeVisible();
  const card = page.getByRole('link', { name: /Playera Sellbase/ });
  await expect(card).toBeVisible();
  // Guards against missing Tailwind output (the e2e would otherwise pass unstyled).
  await expect(page.getByRole('list').first()).toHaveCSS('display', 'grid');
  await card.click();

  await expect(page.getByRole('heading', { name: 'Playera Sellbase' })).toBeVisible();
  await page.getByRole('button', { name: 'Agregar al carrito' }).click();

  const drawer = page.getByRole('dialog', { name: 'Carrito' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Playera Sellbase')).toBeVisible();
  await expect(page.getByRole('button', { name: /Carrito, 1 artículos/ })).toBeVisible();

  await drawer.getByPlaceholder('Código de descuento').fill('NOEXISTE');
  await drawer.getByRole('button', { name: 'Aplicar' }).click();
  await expect(drawer.getByRole('alert')).toContainText('not valid');

  await drawer.getByRole('link', { name: 'Ir a pagar' }).click();
  await expect(page.getByRole('heading', { name: 'Pagar' })).toBeVisible();

  await page.getByLabel('Correo electrónico').fill('e2e@example.com');
  await page.getByLabel('Nombre', { exact: true }).fill('Ana');
  await page.getByLabel('Calle y número').fill('Av. Reforma 222');
  await page.getByLabel('Ciudad').fill('Ciudad de México');
  await page.getByLabel('Estado').fill('CDMX');
  await page.getByLabel('Código postal').fill('06600');
  await expect(page.getByRole('radio').first()).toBeChecked();
  await expect(page.getByTestId('checkout-total')).toHaveText('$448.00'); // 349 + 99 shipping

  await page.getByRole('button', { name: 'Pagar' }).click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
});
