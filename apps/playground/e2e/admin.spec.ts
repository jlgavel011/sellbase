import { expect, test } from '@playwright/test';
import { STRIPE_CONNECTED } from './store-helpers';
import { createOwner, SERVICE_KEY, signIn, SUPABASE_URL } from './admin-helpers';

test.skip(!SERVICE_KEY, 'SUPABASE_SERVICE_ROLE_KEY is required to create the staff user');

test('staff signs in, manages a product, and sees orders and settings', async ({ page }) => {
  const { email, password } = await createOwner();
  await signIn(page, email, password);

  // Home: checklist from /doctor plus the store's custom slot.
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  await expect(page.getByText('Guía de configuración')).toBeVisible();
  await expect(page.getByTestId('custom-slot')).toBeVisible();

  // Custom text override and custom page.
  await expect(page.getByRole('link', { name: /Ventas/ })).toBeVisible();
  await page.getByRole('link', { name: /Reportes/ }).click();
  await expect(page.getByRole('heading', { name: 'Reportes personalizados' })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/reportes$/);

  // Create a product that immediately shows up in the storefront.
  const title = `Sudadera Admin ${Date.now()}`;
  await page.getByRole('link', { name: /Productos/ }).click();
  // Theme from config reaches the compiled admin CSS.
  await expect(page.getByRole('link', { name: 'Nuevo producto' })).toHaveCSS(
    'background-color',
    'rgb(124, 58, 237)',
  );
  await page.getByRole('link', { name: 'Nuevo producto' }).click();
  await page.getByLabel('Título').fill(title);
  await page.getByLabel('Estado').selectOption('active');
  await page.getByLabel('Precio', { exact: true }).fill('599.00');
  await page.getByLabel('Cantidad').fill('7');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Producto creado')).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);

  await page.getByRole('link', { name: 'Productos', exact: true }).first().click();
  await page.getByLabel('Buscar por nombre o SKU').fill(title);
  await expect(page.getByRole('link', { name: title })).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(title) })).toContainText('$599.00');

  const store = await page.request.get(
    'http://127.0.0.1:54321/functions/v1/sellbase-api/v1/storefront/products?limit=100',
  );
  const products = (await store.json()) as { data: { title: string }[] };
  expect(products.data.map((p) => p.title)).toContain(title);

  // Orders list and detail (the demo store has order #1001).
  await page.getByRole('link', { name: /Ventas/ }).click();
  await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();
  const first = page.getByRole('link', { name: /^#\d+$/ }).first();
  if (await first.count()) {
    await first.click();
    await expect(page.getByText('Historial')).toBeVisible();
  }

  // Settings: Stripe status comes from the integration.
  await page.getByRole('link', { name: /Ajustes/ }).click();
  await page.getByRole('link', { name: 'Pagos' }).click();
  if (STRIPE_CONNECTED) {
    await expect(page.getByText('Modo prueba')).toBeVisible();
    await expect(page.getByTestId('payments-card')).toContainText('Cuenta de Stripe');
  } else {
    await expect(page.getByText('Stripe no está conectado')).toBeVisible();
  }

  // Sign out returns to the login screen.
  await page.getByRole('button', { name: 'Cuenta' }).click();
  await page.getByRole('menuitem', { name: /Salir/ }).click();
  await expect(page.getByRole('heading', { name: 'Entra a tu tienda' })).toBeVisible();
});

test('a signed-in user who is not on the team is turned away', async ({ page }) => {
  const email = `stranger-${Date.now()}@example.com`;
  const password = `pw-${crypto.randomUUID()}`;
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  await signIn(page, email, password);
  await expect(page.getByText('no es parte del equipo')).toBeVisible();
});

test('order actions: ship with tracking and refund part of it through Stripe', async ({ page }) => {
  const env = Object.fromEntries(
    (await import('node:fs'))
      .readFileSync(new URL('../../../.env', import.meta.url), 'utf8')
      .split('\n')
      .map((l) => /^([A-Z_]+)=(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => Boolean(m))
      .map((m) => [m[1], m[2]]),
  ) as Record<string, string>;
  test.skip(!env.SELLBASE_DEMO_TOKEN, 'run scripts/seed-demo.mjs first');
  const purchase = await page.request.post(
    'http://127.0.0.1:54321/functions/v1/sellbase-api/v1/test-purchase',
    {
      headers: {
        authorization: `Bearer ${env.SELLBASE_DEMO_TOKEN}`,
        'content-type': 'application/json',
      },
      data: { email: 'refund-e2e@example.com' },
    },
  );
  const result = (await purchase.json()) as {
    ok: boolean;
    order_id: string;
    order_number: number;
    steps: { step: string; ok: boolean }[];
  };
  test.skip(!result.ok, `test_purchase not available: ${JSON.stringify(result.steps)}`);

  const { email, password } = await createOwner();
  await signIn(page, email, password);
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  await page.goto(`/admin/orders/${result.order_id}`);
  await expect(page.getByRole('heading', { name: `Pedido #${result.order_number}` })).toBeVisible();

  await page.getByRole('button', { name: 'Marcar como enviado' }).first().click();
  await page.getByLabel('Paquetería').fill('Estafeta');
  await page.getByLabel('Número de guía').fill('EST-E2E-1');
  await page.getByLabel('URL de rastreo').fill('https://rastreo.test/EST-E2E-1');
  await page.getByRole('button', { name: 'Marcar como enviado' }).last().click();
  await expect(page.getByText('Estafeta · EST-E2E-1')).toBeVisible();
  await expect(page.getByText('Preparado', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Reembolsar' }).first().click();
  await page.getByLabel(/Monto a reembolsar/).fill('99.00');
  await page.getByLabel('Motivo').fill('Envío con retraso');
  await page.getByRole('button', { name: 'Reembolsar' }).last().click();
  await expect(
    page.getByText(/Se reembolsarán \$99\.00 a refund-e2e@example\.com vía Stripe/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Reembolso parcial').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('−$99.00')).toBeVisible();
});
