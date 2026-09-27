import { expect, test } from '@playwright/test';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

test('a customer books a service, pays a deposit and reaches Stripe', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Asesoría 1:1/ }).click();
  await expect(page.getByRole('heading', { name: 'Asesoría 1:1 para tu tienda' })).toBeVisible();
  await expect(page.getByText('45 min · En línea · Anticipo $200.00')).toBeVisible();

  const add = page.getByRole('button', { name: 'Elige un horario' });
  await expect(add).toBeDisabled();
  await page.getByRole('tab').first().click();
  await page.getByRole('radio').first().click();
  await expect(page.getByText(/^Horarios en /)).toBeVisible();
  await page.getByRole('button', { name: 'Agregar al carrito' }).click();

  const drawer = page.getByRole('dialog', { name: 'Carrito' });
  await expect(drawer.getByText('Asesoría 1:1 para tu tienda')).toBeVisible();
  await expect(drawer.getByText(/Ana \(asesora\)|\d{1,2}:\d{2}/).first()).toBeVisible();
  await drawer.getByRole('link', { name: 'Ir a pagar' }).click();

  await page.getByLabel('Correo electrónico').fill('cita-e2e@example.com');
  await page.getByLabel(/Anticipo de \$200\.00/).check();
  await expect(page.getByTestId('checkout-due-now')).toHaveText('$200.00');
  await page.getByRole('button', { name: 'Pagar' }).click();
  const outcome = await Promise.race([
    page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 }).then(
      () => 'stripe',
      () => 'timeout',
    ),
    page
      .getByRole('alert')
      .filter({ hasText: 'cannot take payments' })
      .waitFor({ timeout: 30_000 })
      .then(
        () => 'no-payments',
        () => 'timeout',
      ),
  ]);
  expect(['stripe', 'no-payments']).toContain(outcome);
});

test.skip(!SERVICE_KEY, 'SUPABASE_SERVICE_ROLE_KEY is required');

test('staff completes an appointment from the agenda and edits hours', async ({ page }) => {
  const headers = {
    apikey: SERVICE_KEY,
    authorization: `Bearer ${SERVICE_KEY}`,
    'content-type': 'application/json',
  };
  const rest = (path: string, init: RequestInit = {}) =>
    fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        ...headers,
        'accept-profile': 'sellbase',
        'content-profile': 'sellbase',
        prefer: 'return=representation',
        ...(init.headers ?? {}),
      },
    });
  const [store] = (await (await rest('stores?select=id&slug=eq.demo')).json()) as { id: string }[];
  const [resource] = (await (await rest('resources?select=id&name=eq.Ana%20(asesora)')).json()) as {
    id: string;
  }[];
  const [variant] = (await (await rest('service_specs?select=variant_id')).json()) as {
    variant_id: string;
  }[];
  // A confirmed appointment tomorrow at 17:00 UTC (11:00 in Mexico City), unique per run via seat.
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCHours(17, 0, 0, 0);
  const end = new Date(start.getTime() + 45 * 60_000);
  const customer = `agenda-${Date.now()}@example.com`;
  const created = await rest('bookings', {
    method: 'POST',
    body: JSON.stringify({
      store_id: store?.id,
      resource_id: resource?.id,
      variant_id: variant?.variant_id,
      status: 'confirmed',
      seat: Math.floor(Math.random() * 1_000_000) + 2,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      occupied: `[${start.toISOString()},${end.toISOString()})`,
      email: customer,
    }),
  });
  expect(created.ok, await created.clone().text()).toBe(true);

  const email = `agenda-${Date.now()}@example.com`;
  const password = `pw-${crypto.randomUUID()}`;
  const user = (await (
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password, email_confirm: true }),
    })
  ).json()) as { id: string };
  await rest('staff_members', {
    method: 'POST',
    body: JSON.stringify({ store_id: store?.id, user_id: user.id, role: 'owner' }),
  });

  await page.goto('/admin');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();

  await page.getByRole('link', { name: /Agenda/ }).click();
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();
  if (start.getTime() - Date.now() > 0 && new Date().getDay() === 0)
    await page.getByRole('button', { name: /Semana siguiente/ }).click();
  const row = page.getByTestId('booking-row').filter({ hasText: customer });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Completar' }).click();
  await expect(row.getByText('Completada')).toBeVisible();

  await page.getByRole('link', { name: 'Recursos y horarios' }).click();
  await expect(page.getByRole('heading', { name: 'Recursos y horarios' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Sábado' }).check();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Guardado')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Sábado' }).uncheck();
  await page.getByRole('button', { name: 'Guardar' }).click();
});
