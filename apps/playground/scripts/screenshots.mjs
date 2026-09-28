#!/usr/bin/env node
/**
 * Regenerates the README screenshots (docs/images) from a clean local stack:
 *   pnpm exec supabase db reset && node scripts/seed-demo.mjs   (repo root)
 *   pnpm --filter @sellbase/playground start                    (port 3100)
 *   node apps/playground/scripts/screenshots.mjs
 * It creates a small demo catalog (product art is rendered from HTML, no image files),
 * a few orders and an admin user, then captures the admin and the storefront.
 */
import { chromium } from '@playwright/test';
import { createSellbase } from '@sellbase/sdk';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const repo = new URL('../../../', import.meta.url).pathname;
const env = Object.fromEntries(
  readFileSync(`${repo}.env`, 'utf8')
    .split('\n')
    .map((l) => /^([A-Z_]+)=(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const status = Object.fromEntries(
  execFileSync(`${repo}node_modules/.bin/supabase`, ['status', '-o', 'env'], {
    cwd: repo,
    encoding: 'utf8',
  })
    .split('\n')
    .map((l) => /^([A-Z_]+)="?([^"]*)"?$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const API = `${status.API_URL}/functions/v1/sellbase-api`;
const sb = createSellbase({ url: API, token: env.SELLBASE_DEMO_TOKEN });
const out = `${repo}docs/images`;
mkdirSync(out, { recursive: true });
const ADMIN = { email: 'screenshots@tienda-demo.test', password: `Shots-${Date.now()}` };

// Admin user for the capture.
const user = await fetch(`${status.API_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    apikey: status.SERVICE_ROLE_KEY,
    authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ ...ADMIN, email_confirm: true }),
}).then((r) => r.json());
const storeRes = await fetch(`${status.API_URL}/rest/v1/stores?select=id&slug=eq.demo`, {
  headers: {
    apikey: status.SERVICE_ROLE_KEY,
    authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
    'accept-profile': 'sellbase',
  },
}).then((r) => r.json());
await fetch(`${status.API_URL}/rest/v1/staff_members`, {
  method: 'POST',
  headers: {
    apikey: status.SERVICE_ROLE_KEY,
    authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    'content-profile': 'sellbase',
  },
  body: JSON.stringify({ store_id: storeRes[0].id, user_id: user.id, role: 'owner' }),
});

const browser = await chromium.launch();
async function art(emoji, from, to) {
  const p = await browser.newPage({ viewport: { width: 800, height: 800 } });
  await p.setContent(
    `<body style="margin:0;display:grid;place-items:center;height:800px;background:linear-gradient(135deg,${from},${to});font-size:360px">${emoji}</body>`,
  );
  const buf = await p.screenshot({ type: 'png' });
  await p.close();
  return buf.toString('base64');
}

const collection = await sb.admin.collections.upsert({ title: 'Lo más vendido' });
const catalog = [
  [
    'Playera Clásica',
    '👕',
    '#fde68a',
    '#f59e0b',
    34900,
    39900,
    ['Talla', ['S', 'M', 'L']],
    [12, 3, 0],
  ],
  ['Gorra Bordada', '🧢', '#bfdbfe', '#3b82f6', 29900, null, null, [18]],
  ['Taza de Cerámica', '☕', '#fecaca', '#ef4444', 19900, null, null, [4]],
  [
    'Sudadera Oversize',
    '🧥',
    '#e9d5ff',
    '#8b5cf6',
    79900,
    89900,
    ['Color', ['Negro', 'Arena']],
    [6, 2],
  ],
];
for (const p of (await sb.admin.products.search({ limit: 100 })).data)
  if (p.type !== 'service')
    await sb.admin.products.bulk({ product_ids: [p.id], action: 'archive' });
const ids = [];
for (const [title, emoji, from, to, price, compare, option, stock] of catalog) {
  const combos = option ? option[1].map((v) => ({ [option[0]]: v })) : [{}];
  const p = await sb.admin.products.upsert({
    type: 'physical',
    title,
    status: 'active',
    description: `${title} de la tienda demo.`,
    collection_ids: [collection.id],
    ...(option ? { options: [{ name: option[0], values: option[1] }] } : {}),
    variants: combos.map((ov, i) => ({
      title: Object.values(ov).join(' / ') || 'Default',
      option_values: ov,
      price_amount: price,
      compare_at_amount: compare,
      sku: `${title.slice(0, 3).toUpperCase()}-${i + 1}`,
      inventory: { on_hand: stock[i] ?? 10 },
      physical: {
        weight_g: 300,
        length_cm: 0,
        width_cm: 0,
        height_cm: 0,
        requires_shipping: true,
        hs_code: null,
      },
    })),
  });
  await sb.admin.products.addMedia(p.id, {
    file_name: 'art.png',
    content_base64: await art(emoji, from, to),
    alt: title,
  });
  ids.push(p);
}
const vid = (i, v = 0) => ids[i].variants.filter((x) => x.status === 'active')[v].id;
for (const [email, first_name, last_name, channel, items] of [
  [
    'maria.lopez@example.com',
    'María',
    'López',
    'whatsapp',
    [
      [vid(0, 1), 2],
      [vid(1), 1],
    ],
  ],
  ['carlos.ruiz@example.com', 'Carlos', 'Ruiz', 'admin', [[vid(3), 1]]],
  ['fer.gomez@example.com', 'Fernanda', 'Gómez', 'whatsapp', [[vid(2), 2]]],
  [
    'diego.mtz@example.com',
    'Diego',
    'Martínez',
    'admin',
    [
      [vid(0, 0), 1],
      [vid(2), 1],
    ],
  ],
]) {
  await sb.admin.orders.create({
    email,
    first_name,
    last_name,
    channel,
    items: items.map(([variant_id, quantity]) => ({ variant_id, quantity })),
    shipping_amount: 9900,
    shipping_address: {
      first_name,
      last_name,
      line1: 'Av. Insurgentes 123',
      city: 'Ciudad de México',
      state: 'CDMX',
      postal_code: '03100',
      country: 'MX',
    },
    payment: { mode: 'paid', method: channel === 'whatsapp' ? 'spei' : 'cash' },
    notify_customer: false,
    confirm: true,
  });
}

const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const shot = async (name, full = false) => {
  await page.waitForTimeout(2200);
  await page.mouse.move(1, 899);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
};
await page.goto('http://localhost:3100/admin');
await shot('admin-login');
await page.getByLabel('Correo').fill(ADMIN.email);
await page.getByLabel('Contraseña').fill(ADMIN.password);
await page.getByRole('button', { name: 'Entrar' }).click();
await page.getByRole('heading', { name: 'Inicio' }).waitFor();
await shot('admin-home');
await page.goto('http://localhost:3100/admin/products');
await shot('admin-products');
await page.goto(`http://localhost:3100/admin/products/${ids[0].id}`);
await shot('admin-product-editor');
await page.goto('http://localhost:3100/admin/orders');
await shot('admin-orders');
await page.locator('[data-testid="order-row"] a').first().click();
await shot('admin-order');
await page.goto('http://localhost:3100/admin/settings/checkout');
await shot('admin-settings');
await page.goto('http://localhost:3100/admin');
await page.getByRole('heading', { name: 'Inicio' }).waitFor();
await page.keyboard.press('Meta+k');
await page.keyboard.type('pla');
await shot('admin-command-palette');
await page.goto('http://localhost:3100/');
await shot('storefront');
await browser.close();
console.log(`Screenshots written to ${out}`);
