import type { Page } from '@playwright/test';

/**
 * Admin against the local stack. Needs SUPABASE_SERVICE_ROLE_KEY (from
 * `supabase status -o env`) only to create the staff user for the test.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// In CI a missing key must fail loudly: skipping would hide the admin specs (it did once,
// when turbo filtered the variable out).
if (process.env.CI && !SERVICE_KEY)
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set in CI (check turbo.json passThroughEnv).');

export async function createOwner() {
  const email = `owner-${crypto.randomUUID()}@example.com`;
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

export async function signIn(page: Page, email: string, password: string, url = '/admin') {
  await page.goto(url);
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}
