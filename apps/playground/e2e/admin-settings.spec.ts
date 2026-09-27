import { expect, test } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createOwner, SERVICE_KEY, signIn } from './admin-helpers';

test.skip(!SERVICE_KEY, 'SUPABASE_SERVICE_ROLE_KEY is required to create the staff user');

test('team invites, agent tokens with activity, and signed webhooks', async ({ page }) => {
  const { email, password } = await createOwner();
  await signIn(page, email, password);
  const tag = Date.now().toString(36);

  // Team: invite a staff member by email.
  await page.getByRole('link', { name: /Ajustes/ }).click();
  await page.getByRole('link', { name: 'Equipo' }).click();
  const invitee = `equipo-${tag}@example.com`;
  await page.getByLabel('Correo').fill(invitee);
  await page.getByRole('button', { name: 'Invitar' }).click();
  await expect(page.getByText(`Listo: ${invitee} recibirá un correo`)).toBeVisible();
  const row = page.getByTestId('team-row').filter({ hasText: invitee });
  await expect(row).toContainText('Invitación pendiente');
  await row.getByRole('combobox').selectOption('admin');
  await expect(row.getByRole('combobox')).toHaveValue('admin');
  await page.screenshot({ path: 'test-results/admin-team.png', fullPage: true });

  // AI agents: create a token, use it, see what it did, revoke it.
  await page.getByRole('link', { name: 'Agentes IA' }).click();
  await page.getByLabel('Nombre').fill(`Agente ${tag}`);
  await page.getByLabel('Reembolsar dinero').check();
  await expect(page.getByText('Reembolsar mueve dinero real')).toBeVisible();
  await page.getByLabel('Reembolsar dinero').uncheck();
  await page.getByRole('button', { name: 'Crear token' }).click();
  const token = await page.getByTestId('new-token').getByRole('textbox').inputValue();
  expect(token).toMatch(/^sb_live_/);

  const api = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'}/functions/v1/sellbase-api/v1`;
  const created = await fetch(`${api}/products`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'digital',
      title: `Producto IA ${tag}`,
      variants: [{ price_amount: 1000 }],
    }),
  });
  expect(created.status).toBe(200);
  await page.reload();
  await expect(page.getByTestId('agent-activity')).toContainText(`Agente ${tag}`);
  await expect(page.getByTestId('agent-activity')).toContainText('product.create');
  const tokenRow = page.getByTestId('token-row').filter({ hasText: `Agente ${tag}` });
  await expect(tokenRow).toContainText('1 acción en 30 días');
  await page.screenshot({ path: 'test-results/admin-agents.png', fullPage: true });
  await tokenRow.getByRole('button', { name: 'Revocar' }).click();
  await tokenRow.getByRole('button', { name: 'Sí, revocar' }).click();
  await expect(tokenRow).toContainText('Revocado');
  const denied = await fetch(`${api}/products`, { headers: { authorization: `Bearer ${token}` } });
  expect(denied.status).toBe(401);

  // Webhooks: a local receiver gets a signed test event.
  const received: { body: string; signature: string }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push({ body, signature: String(req.headers['sellbase-signature'] ?? '') });
      res.end('ok');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await page.getByRole('link', { name: 'Webhooks' }).click();
    await page
      .getByLabel('URL que recibe los eventos')
      .fill(`http://host.docker.internal:${port}/hook`);
    await page.getByLabel('order.paid').check();
    await page.getByRole('button', { name: 'Agregar endpoint' }).click();
    const secret = await page.getByTestId('webhook-secret').getByRole('textbox').inputValue();
    expect(secret).toMatch(/^whsec_/);
    const endpoint = page.getByTestId('webhook-endpoint').filter({ hasText: `:${port}` });
    await endpoint.getByRole('button', { name: 'Enviar prueba' }).click();
    await expect(endpoint.getByTestId('webhook-delivery').first()).toContainText('webhook.test');
    // Docker Desktop reaches the host; on Linux CI the delivery is recorded as a retry instead.
    if (received.length > 0) {
      const { body, signature } = received[0] ?? { body: '', signature: '' };
      const [t, v1] = signature.split(',').map((p) => p.split('=')[1]);
      expect(createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')).toBe(v1);
      await expect(endpoint.getByTestId('webhook-delivery').first()).toContainText('Entregado');
    }
    await page.screenshot({ path: 'test-results/admin-webhooks.png', fullPage: true });
    await endpoint.getByRole('button', { name: 'Pausar' }).click();
    await expect(endpoint).toContainText('Pausado');
    await endpoint.getByRole('button', { name: 'Eliminar' }).click();
    await endpoint.getByRole('button', { name: 'Sí, eliminar' }).click();
    await expect(endpoint).toHaveCount(0);
  } finally {
    server.close();
  }
});
