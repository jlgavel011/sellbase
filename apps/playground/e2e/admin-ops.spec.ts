import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createOwner, SERVICE_KEY, signIn } from './admin-helpers';

test.skip(!SERVICE_KEY, 'SUPABASE_SERVICE_ROLE_KEY is required to create the staff user');

test('CSV import, bulk price change, manual order and order filters', async ({ page }, info) => {
  const { email, password } = await createOwner();
  await signIn(page, email, password);
  const tag = Date.now().toString(36);

  // Import two products from CSV: check first, then import.
  await page
    .getByRole('link', { name: /Productos/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Importar CSV' }).click();
  const file = info.outputPath('productos.csv');
  await writeFile(
    file,
    `nombre,precio,existencias,estado,handle\nLlavero ${tag},50,20,activo,llavero-${tag}\nImán ${tag},35,abc,activo,iman-${tag}\n`,
  );
  await page.getByLabel('Archivo CSV').setInputFiles(file);
  const report = page.getByTestId('import-report');
  await expect(report).toContainText('Se crearán 1');
  await expect(report).toContainText('Fila 3');
  await page.screenshot({ path: 'test-results/admin-import.png', fullPage: true });
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
  await expect(report).toContainText('Listo: 1 creado(s)');
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();

  // Bulk price: +10% on the imported product, previewed before applying.
  await page.getByLabel('Buscar por nombre o SKU').fill(`Llavero ${tag}`);
  await expect(page.getByTestId('product-row')).toHaveCount(1);
  await page.getByLabel(`Seleccionar Llavero ${tag}`).check();
  await page.getByRole('button', { name: 'Cambiar precio' }).click();
  await page.getByLabel('Valor').fill('10');
  await page.getByRole('button', { name: 'Ver cambios' }).click();
  await expect(page.getByTestId('price-preview-row')).toContainText('$55.00');
  await page.screenshot({ path: 'test-results/admin-bulk-price.png', fullPage: true });
  await page.getByRole('button', { name: 'Aplicar precios nuevos' }).click();
  await expect(page.getByText('1 actualizado(s).')).toBeVisible();
  await expect(page.getByTestId('product-row')).toContainText('$55.00');

  // Manual order paid in cash, with confirmation.
  const buyer = `mostrador-${tag}@example.com`;
  await page
    .getByRole('link', { name: /Ventas|Pedidos/ })
    .first()
    .click();
  await page.getByRole('link', { name: 'Nuevo pedido' }).click();
  await page.getByRole('textbox', { name: 'Correo' }).fill(buyer);
  await page.getByLabel('Canal').selectOption('whatsapp');
  await page.getByLabel('Buscar producto…').fill(`Llavero ${tag}`);
  await page.getByRole('button', { name: `Agregar Llavero ${tag}` }).click();
  await page.getByLabel('Cantidad').fill('3');
  await expect(page.getByTestId('manual-order-subtotal')).toContainText('$165.00');
  await page.screenshot({ path: 'test-results/admin-manual-order.png', fullPage: true });
  await page.getByRole('button', { name: 'Registrar pedido' }).click();
  await expect(page.getByText(/Vas a registrar \$165\.00 cobrados en efectivo/)).toBeVisible();
  await page.getByRole('button', { name: 'Sí, registrar' }).click();
  await expect(page.getByTestId('manual-order-done')).toContainText('$165.00');
  await page.getByRole('link', { name: 'Ver pedido' }).click();
  await expect(page.getByText('Pedido manual registrado (pagado: efectivo).')).toBeVisible();

  // Filters: WhatsApp channel + search find exactly this order.
  await page
    .getByRole('link', { name: /Ventas|Pedidos/ })
    .first()
    .click();
  await page.getByLabel('Canal').selectOption('whatsapp');
  await page.getByLabel('Buscar #pedido o correo').fill(buyer);
  await expect(page.getByTestId('order-row')).toHaveCount(1);
  await expect(page.getByTestId('order-row')).toContainText('WhatsApp');
  await page.getByRole('button', { name: 'Más filtros' }).click();
  await page.getByLabel('Estado').selectOption('cancelled');
  await expect(page.getByTestId('order-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await expect(page.getByTestId('order-row').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-orders-filters.png', fullPage: true });
});
