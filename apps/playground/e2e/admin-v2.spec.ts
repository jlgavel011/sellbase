import { expect, test, type Page } from '@playwright/test';
import { createOwner, SERVICE_KEY, signIn } from './admin-helpers';

test.skip(!SERVICE_KEY, 'SUPABASE_SERVICE_ROLE_KEY is required to create the staff user');

/** A PNG made in the page (no fixture files), dropped on the media area like a real file. */
async function dropImage(page: Page, name: string) {
  await page.evaluate(async (fileName) => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#0f766e';
      ctx.fillRect(0, 0, 120, 120);
    }
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b as Blob), 'image/png'),
    );
    const data = new DataTransfer();
    data.items.add(new File([blob], fileName, { type: 'image/png' }));
    document
      .querySelector('[data-testid="media-dropzone"]')
      ?.dispatchEvent(
        new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }),
      );
  }, name);
}

test('product editor: photos before saving, variants, inventory and search', async ({ page }) => {
  const { email, password } = await createOwner();
  await signIn(page, email, password);
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  const title = `Sudadera V2 ${Date.now().toString(36)}`;

  await page.goto('/admin/products/new');
  await page.getByLabel('Título').fill(title);
  await dropImage(page, 'frente.png');
  await dropImage(page, 'espalda.png');
  await expect(page.getByTestId('media-tile')).toHaveCount(2);
  await expect(page.getByText('Se sube al guardar').first()).toBeVisible();
  // Unsaved changes show the save bar.
  await expect(page.getByRole('region', { name: 'Cambios sin guardar' })).toBeVisible();

  await page.getByLabel('Precio', { exact: true }).fill('799');
  await page.getByRole('button', { name: 'Agregar opciones como talla o color' }).click();
  await page.getByLabel('Nombre de la opción').fill('Talla');
  const values = page.getByPlaceholder('Agrega un valor y presiona Enter');
  await values.fill('M');
  await values.press('Enter');
  await values.fill('L');
  await values.press('Enter');
  await expect(page.getByTestId('variant-row')).toHaveCount(2);
  await page.getByLabel('Cantidad M').fill('4');
  await page.getByLabel('Cantidad L').fill('2');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Producto creado')).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('media-tile')).toHaveCount(2);
  await expect(page.getByText('Se sube al guardar')).toHaveCount(0);
  await expect(page.getByTestId('variant-row')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/admin-v2-product.png', fullPage: true });

  // Reorder: the second photo becomes the main one.
  const second = await page.getByTestId('media-tile').nth(1).locator('img').getAttribute('src');
  await page.getByTestId('media-tile').nth(1).hover();
  await page.getByRole('button', { name: 'Mover antes' }).first().click();
  await expect(page.getByTestId('media-tile').first().locator('img')).toHaveAttribute(
    'src',
    second ?? '',
  );

  // Inventory: low stock shows the L size; adjust it inline.
  await page.goto('/admin/products/inventory');
  await page.getByLabel('Buscar por producto o SKU').fill(title);
  await expect(page.getByTestId('inventory-row')).toHaveCount(2);
  const row = page.getByTestId('inventory-row').filter({ hasText: /^.*L/ }).last();
  const input = row.getByRole('textbox');
  await input.fill('9');
  await row.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Inventario actualizado')).toBeVisible();
  await expect(input).toHaveValue('9');

  // Global search finds the product.
  await page.getByRole('searchbox', { name: 'Buscar productos, pedidos y clientes' }).fill(title);
  await page.getByRole('button', { name: new RegExp(title) }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
});

test('settings sections, consent at checkout and abandoned carts page', async ({ page }) => {
  const { email, password } = await createOwner();
  await signIn(page, email, password);
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();

  await page.goto('/admin/settings/checkout');
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  // The demo store is shared by parallel specs: edit, check the preview, then discard.
  // The server side of the required consent is covered by the API integration tests.
  const consent = page.getByRole('switch', { name: 'Pedir una confirmación antes de pagar' });
  await consent.click();
  await page.getByLabel('Texto de la casilla').fill('Confirmo que soy mayor de 18 años');
  await expect(page.getByText('Confirmo que soy mayor de 18 años').last()).toBeVisible();
  const bar = page.getByRole('region', { name: 'Cambios sin guardar' });
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Descartar' }).click();
  await expect(consent).toHaveAttribute('aria-checked', 'false');
  await expect(bar).toHaveCount(0);

  await page.getByRole('link', { name: 'Integraciones' }).click();
  await expect(page.getByTestId('integration-stripe')).toBeVisible();
  await page.getByRole('link', { name: 'Notificaciones' }).click();
  await page.getByRole('button', { name: 'Enviar correo de prueba' }).click();
  await expect(page.getByRole('status').filter({ hasText: /correo de prueba/ })).toBeVisible();

  await page.goto('/admin/orders/abandoned');
  await expect(page.getByRole('heading', { name: 'Carritos abandonados' })).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-v2-abandoned.png', fullPage: true });
});
