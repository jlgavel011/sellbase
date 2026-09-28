#!/usr/bin/env node
/**
 * Seeds the local stack with the demo store the playground e2e tests expect: a physical
 * T-shirt with stock, a digital guide with its file, manual shipping and (when
 * STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET are set) Stripe in test mode.
 * Writes SELLBASE_DEMO_TOKEN to .env. Safe to rerun: it reuses the existing store.
 */
import { createSellbase } from '@sellbase/sdk';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import postgres from 'postgres';

const repo = resolve(import.meta.dirname, '..');
const envPath = join(repo, '.env');
const fileEnv = existsSync(envPath)
  ? Object.fromEntries(
      readFileSync(envPath, 'utf8')
        .split('\n')
        .map((l) => /^([A-Z_]+)=(.*)$/.exec(l))
        .filter(Boolean)
        .map((m) => [m[1], m[2]]),
    )
  : {};
const env = { ...fileEnv, ...process.env };
const status = Object.fromEntries(
  execFileSync(join(repo, 'node_modules/.bin/supabase'), ['status', '-o', 'env'], {
    cwd: repo,
    encoding: 'utf8',
  })
    .split('\n')
    .map((l) => /^([A-Z_]+)="?([^"]*)"?$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const sql = postgres(status.DB_URL, { max: 1, onnotice: () => undefined });
try {
  let [store] = await sql`select id from sellbase.stores where slug = 'demo'`;
  if (!store) {
    [store] = await sql`
      insert into sellbase.stores (name, slug, default_currency, country, contact_email, settings)
      values ('Tienda Demo Sellbase', 'demo', 'MXN', 'MX', 'hola@tienda-demo.test',
              ${sql.json({ tax: { mode: 'inclusive', rate_bps: 1600 }, brand_color: '#7c3aed', shipping: { flat_rate_amount: 9900, free_over_amount: 150000, pickup: { enabled: true } } })})
      returning id`;
  }
  const token = `sb_live_${randomBytes(24).toString('base64url')}`;
  await sql`
    insert into sellbase.api_tokens (store_id, name, token_hash, prefix, scopes)
    values (${store.id}, 'demo seed', ${createHash('sha256').update(token).digest('hex')}, ${token.slice(0, 12)},
            array['catalog:read','catalog:write','orders:read','orders:write','customers:read','discounts:write','settings:write','integrations:write'])`;

  await sql`select sellbase.configure_jobs('http://kong:8000/functions/v1/sellbase-jobs', ${status.SERVICE_ROLE_KEY})`;
  const url = `${status.API_URL}/functions/v1/sellbase-api`;
  const sb = createSellbase({ url, token });
  // The Edge Function can still be booting right after `supabase start` (HTTP 500/503).
  let existing;
  for (let attempt = 1; ; attempt++) {
    try {
      existing = await sb.admin.products.search({ limit: 100 });
      break;
    } catch (error) {
      if (attempt >= 15 || !/HTTP 5\d\d/.test(String(error?.message))) throw error;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  const has = (title) => existing.data.some((p) => p.title === title);

  if (!has('Playera Sellbase')) {
    await sb.admin.products.upsert({
      type: 'physical',
      title: 'Playera Sellbase',
      status: 'active',
      description: 'Algodón 100%.',
      variants: [
        {
          title: 'M',
          sku: 'PLAY-M',
          price_amount: 34900,
          inventory: { on_hand: 50 },
          physical: { weight_g: 200, length_cm: 30, width_cm: 25, height_cm: 2 },
        },
      ],
    });
  }
  if (!has('Guía para vender con IA')) {
    const guide = await sb.admin.products.upsert({
      type: 'digital',
      title: 'Guía para vender con IA',
      status: 'active',
      variants: [{ price_amount: 19900 }],
    });
    await sb.admin.variants.uploadFile(guide.variants[0].id, {
      file_name: 'guia-vender-con-ia.pdf',
      content_base64: Buffer.from('%PDF-1.4\n% Sellbase demo\n').toString('base64'),
      download_limit: 3,
    });
  }
  if (!has('Asesoría 1:1 para tu tienda')) {
    const service = await sb.admin.products.upsert({
      type: 'service',
      title: 'Asesoría 1:1 para tu tienda',
      status: 'active',
      description: 'Revisamos juntos tu tienda y tu estrategia de ventas.',
      variants: [
        {
          price_amount: 60000,
          service: {
            duration_min: 45,
            location_type: 'online',
            online_meeting_url: 'https://meet.example.com/asesoria',
            deposit_amount: 20000,
            min_notice_min: 60,
            slot_interval_min: 60,
          },
        },
      ],
    });
    await sb.admin.resources.upsert({
      name: 'Ana (asesora)',
      rules: [1, 2, 3, 4, 5].map((weekday) => ({
        weekday,
        start_time: '09:00',
        end_time: '18:00',
      })),
      product_ids: [service.id],
    });
  }
  if (env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET) {
    await sb.admin.integrations.connect('stripe', {
      secret_key: env.STRIPE_SECRET_KEY,
      webhook_secret: env.STRIPE_WEBHOOK_SECRET,
    });
    console.log('Stripe connected (test mode).');
  } else {
    console.log(
      'STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET not set: checkout will ask to connect payments.',
    );
  }

  const text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const line = `SELLBASE_DEMO_TOKEN=${token}`;
  writeFileSync(
    envPath,
    /^SELLBASE_DEMO_TOKEN=.*$/m.test(text)
      ? text.replace(/^SELLBASE_DEMO_TOKEN=.*$/m, line)
      : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`,
    { mode: 0o600 },
  );
  console.log(`Demo store ready (${store.id}); token saved to .env.`);
} finally {
  await sql.end();
}
