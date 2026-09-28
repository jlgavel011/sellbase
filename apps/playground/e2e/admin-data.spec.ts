import { expect, test } from '@playwright/test';
import { createOwner, SERVICE_KEY, signIn } from './admin-helpers';

test.skip(!SERVICE_KEY, 'SUPABASE_SERVICE_ROLE_KEY is required to create the staff user');

test('home metrics, discounts, collections and customers', async ({ page }) => {
  const { email, password } = await createOwner();
  await signIn(page, email, password);

  // Home: sales metrics from /reports/summary above the checklist.
  await expect(page.getByTestId('metric-today')).toContainText('Ventas de hoy');
  await expect(page.getByTestId('metric-30')).toContainText('$');
  await expect(page.getByText('Ventas por día (30 días)')).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-home-metrics.png', fullPage: true });

  // Discounts: create a code, then edit it.
  const code = `E2E${Date.now().toString(36).toUpperCase()}`;
  await page.getByRole('link', { name: /Descuentos/ }).click();
  await page.getByRole('button', { name: 'Nuevo descuento' }).click();
  await page.getByRole('textbox', { name: 'Código' }).fill(code);
  await page.getByLabel('Porcentaje (%)').fill('15');
  await page.getByLabel(/Compra mínima/).fill('300');
  await page.getByRole('button', { name: 'Guardar descuento' }).click();
  await expect(page.getByText('Descuento guardado.')).toBeVisible();
  const row = page.getByTestId('discount-row').filter({ hasText: code });
  await expect(row).toContainText('15%');
  await expect(row).toContainText('$300.00');
  await row.getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel('Estado').selectOption('disabled');
  await page.getByRole('button', { name: 'Guardar descuento' }).click();
  await expect(row).toContainText('Pausado');
  await page.screenshot({ path: 'test-results/admin-discounts.png', fullPage: true });
  await row.getByRole('button', { name: 'Editar' }).click();
  await page.getByRole('button', { name: 'Eliminar' }).click();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Descuento eliminado.')).toBeVisible();
  await expect(row).toHaveCount(0);

  // Collections: from Products, group two products and reorder them.
  const title = `Regalos ${Date.now().toString(36)}`;
  await page
    .getByRole('link', { name: /Productos/ })
    .first()
    .click();
  await page.getByRole('link', { name: 'Colecciones' }).click();
  await page.getByRole('button', { name: 'Nueva colección' }).click();
  await page.getByLabel('Nombre').fill(title);
  const boxes = page.getByRole('checkbox');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole('button', { name: 'Mover después' }).first().click();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Colección guardada.')).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(title) })).toContainText('2 productos');
  await page.screenshot({ path: 'test-results/admin-collections.png', fullPage: true });
  await page.getByRole('button', { name: 'Eliminar colección' }).click();
  await page.getByRole('button', { name: /Sí, eliminar/ }).click();
  await expect(page.getByRole('button', { name: new RegExp(title) })).toHaveCount(0);

  // Customers: list with totals, detail with order history.
  await page.getByRole('link', { name: /Clientes/ }).click();
  await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
  const customers = page.getByTestId('customer-row');
  await customers.or(page.getByText('Aún no tienes clientes')).first().waitFor();
  if ((await customers.count()) > 0) {
    await customers.first().getByRole('link').click();
    await expect(page.getByTestId('customer-spent')).toContainText('$');
    await expect(page.getByText('Pedidos').first()).toBeVisible();
    await page.screenshot({ path: 'test-results/admin-customer.png', fullPage: true });
  }
});
