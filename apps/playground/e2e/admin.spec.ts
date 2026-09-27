import { expect, test, type Page } from '@playwright/test';

/**
 * Admin against the local stack. Needs SUPABASE_SERVICE_ROLE_KEY (from
 * `supabase status -o env`) only to create the staff user for the test.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

async function createOwner() {
  const email = `owner-${Date.now()}@example.com`;
  const password = `pw-${crypto.randomUUID()}`;
  const headers = {
    apikey: SERVICE_KEY,
    authorization: `Bearer ${SERVICE_KEY}`,
    'content-type': 'application/json',
  };
  const user = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password, email_confirm: true }),
  }).then((r) => r.json() as Promise<{ id: string }>);
  const stores = await fetch(`${SUPABASE_URL}/rest/v1/stores?select=id&order=created_at&limit=1`, {
    headers: { ...headers, 'accept-profile': 'sellbase' },
  }).then((r) => r.json() as Promise<{ id: string }[]>);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/staff_members`, {
    method: 'POST',
    headers: { ...headers, 'content-profile': 'sellbase' },
    body: JSON.stringify({ store_id: stores[0]?.id, user_id: user.id, role: 'owner' }),
  });
  if (!res.ok) throw new Error(`staff insert failed: ${res.status} ${await res.text()}`);
  return { email, password };
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/admin');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test.skip(!SERVICE_KEY, 'SUPABASE_SERVICE_ROLE_KEY is required to create the staff user');

test('staff signs in, manages a product, and sees orders and settings', async ({ page }) => {
  const { email, password } = await createOwner();
  await signIn(page, email, password);

  // Home: checklist from /doctor plus the store's custom slot.
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  await expect(page.getByText('Lista de configuración')).toBeVisible();
  await expect(page.getByTestId('custom-slot')).toBeVisible();
  // Theme from config reaches the compiled admin CSS.
  await expect(page.getByRole('link', { name: /Inicio/ })).toHaveCSS(
    'background-color',
    'rgb(124, 58, 237)',
  );

  // Custom text override and custom page.
  await expect(page.getByRole('link', { name: /Ventas/ })).toBeVisible();
  await page.getByRole('link', { name: /Reportes/ }).click();
  await expect(page.getByRole('heading', { name: 'Reportes personalizados' })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/reportes$/);

  // Create a product that immediately shows up in the storefront.
  const title = `Sudadera Admin ${Date.now()}`;
  await page.getByRole('link', { name: /Productos/ }).click();
  await page.getByRole('link', { name: 'Nuevo producto' }).click();
  await page.getByLabel('Nombre').fill(title);
  await page.getByLabel('Estado').selectOption('active');
  await page.getByLabel(/Precio/).fill('599.00');
  await page.getByLabel('Stock').fill('7');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Guardado')).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);

  await page.getByRole('link', { name: '← Productos' }).click();
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
  await expect(page.getByText('Stripe conectado')).toBeVisible();

  // Sign out returns to the login screen.
  await page.getByRole('button', { name: 'Salir' }).click();
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
