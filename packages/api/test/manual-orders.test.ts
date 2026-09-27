import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJobs } from '../src/index.js';
import { createTestStore, sendWebhook, sql, type TestStore } from './helpers.js';

let s: TestStore;
let token: string;
let mugVariant: string;
let ebookVariant: string;
let mugProduct: string;

beforeAll(async () => {
  s = await createTestStore();
  token = await s.token();
  const mug = await s.request('POST', '/products', {
    token,
    body: {
      type: 'physical',
      title: 'Taza',
      status: 'active',
      variants: [{ sku: 'TZ', price_amount: 15000, inventory: { on_hand: 5 } }],
    },
  });
  mugProduct = mug.body.id;
  mugVariant = mug.body.variants[0].id;
  const ebook = await s.request('POST', '/products', {
    token,
    body: { type: 'digital', title: 'Ebook', status: 'active', variants: [{ price_amount: 9900 }] },
  });
  ebookVariant = ebook.body.variants[0].id;
});

afterAll(async () => {
  await sql.end();
});

describe('manual orders', () => {
  it('asks for confirmation before recording money', async () => {
    const res = await s.request('POST', '/orders', {
      token,
      body: {
        email: 'cliente@test.dev',
        items: [{ variant_id: mugVariant, quantity: 1 }],
        payment: { mode: 'paid', method: 'cash' },
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.hint).toContain('confirm: true');
  });

  it('records a cash sale with price override, discount and stock', async () => {
    await s.request('POST', '/discounts', {
      token,
      body: { code: 'MOSTRADOR', kind: 'fixed', value: 2000 },
    });
    const email = `mostrador-${randomUUID()}@test.dev`;
    const res = await s.request('POST', '/orders', {
      token,
      body: {
        email,
        first_name: 'Ana',
        channel: 'whatsapp',
        items: [{ variant_id: mugVariant, quantity: 2, unit_price_amount: 12000 }],
        discount_codes: ['mostrador'],
        payment: { mode: 'paid', method: 'cash', reference: 'Caja 1' },
        confirm: true,
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.payment_url).toBeNull();
    expect(res.body.order).toMatchObject({
      channel: 'whatsapp',
      status: 'open',
      payment_status: 'paid',
      subtotal_amount: 24000,
      discount_amount: 2000,
      total_amount: 22000,
      amount_paid: 22000,
    });
    expect(res.body.order.payments[0]).toMatchObject({
      provider: 'manual',
      method: 'cash',
      amount: 22000,
    });
    expect(res.body.order.items[0]).toMatchObject({ unit_price_amount: 12000, quantity: 2 });

    const product = await s.request('GET', `/products/${mugProduct}`, { token });
    expect(product.body.variants[0].inventory.on_hand).toBe(3);
    const customer = await s.request('GET', `/customers?q=${encodeURIComponent(email)}`, { token });
    expect(customer.body.data[0]).toMatchObject({ first_name: 'Ana', total_spent_amount: 22000 });

    await runJobs(s.deps, { storeId: s.storeId });
    expect(s.emails.some((m) => m.to === email)).toBe(true);
    const [audit] = await sql`
      select actor_type from sellbase.audit_log where entity_id = ${res.body.order.id} and action = 'order.create_manual'`;
    expect(audit?.actor_type).toBe('token');
  });

  it('never sells stock it does not have', async () => {
    const res = await s.request('POST', '/orders', {
      token,
      body: {
        email: 'mucho@test.dev',
        items: [{ variant_id: mugVariant, quantity: 50 }],
        payment: { mode: 'paid', method: 'cash' },
        confirm: true,
      },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OUT_OF_STOCK');
  });

  it('sends a payment link and opens the order when it is paid', async () => {
    await sql`update sellbase.stores set settings = settings || '{"site_url": "https://tienda.test"}' where id = ${s.storeId}`;
    const email = `link-${randomUUID()}@test.dev`;
    const res = await s.request('POST', '/orders', {
      token,
      body: {
        email,
        items: [{ variant_id: ebookVariant, quantity: 1 }],
        payment: { mode: 'link' },
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.payment_url).toContain('https://pay.test/');
    expect(res.body.order).toMatchObject({
      status: 'pending_payment',
      payment_status: 'unpaid',
      total_amount: 9900,
    });
    expect(s.payments.created.at(-1)).toMatchObject({
      order_id: res.body.order.id,
      amount_total: 9900,
      lines: [{ title: `Pedido #${res.body.order.number}` }],
    });

    const eventId = `evt_${randomUUID()}`;
    const hook = await sendWebhook(s, {
      id: eventId,
      data: {
        type: 'order.balance_paid',
        provider_event_id: eventId,
        order_id: res.body.order.id,
        provider_payment_id: `pi_${randomUUID()}`,
        amount: 9900,
        currency: 'MXN',
        method: 'card',
        raw: {},
      },
    });
    expect(hook.body.outcome).toBe('balance_recorded');
    await runJobs(s.deps, { storeId: s.storeId });
    const order = await s.request('GET', `/orders/${res.body.order.id}`, { token });
    expect(order.body).toMatchObject({
      status: 'completed', // digital only: delivered as soon as it is paid
      payment_status: 'paid',
      fulfillment_status: 'fulfilled',
    });
    // First confirmation (with the download link) goes out when the link is paid.
    expect(s.emails.filter((m) => m.to === email)).toHaveLength(1);
  });

  it('rejects services and unknown variants with a hint', async () => {
    const res = await s.request('POST', '/orders', {
      token,
      body: {
        email: 'x@test.dev',
        items: [{ variant_id: randomUUID() }],
        payment: { mode: 'paid', method: 'cash' },
        confirm: true,
      },
    });
    expect(res.status).toBe(404);
    expect(res.body.error.hint).toContain('products_search');
  });

  it('filters orders by channel', async () => {
    const res = await s.request('GET', '/orders?channel=whatsapp', { token });
    expect(res.body.data).toHaveLength(1);
  });
});

describe('products import and bulk actions', () => {
  const csv = [
    'handle,title,price,sku,stock,status,option1 name,option1 value,image',
    'gorra,Gorra,199.00,GR-N,4,activo,Color,Negra,https://cdn.test/gorra.jpg',
    'gorra,,199.00,GR-B,2,,,Blanca,',
    'taza,Taza,160.00,TZ,9,,,,',
    'rota,Rota,abc,,,,,,',
  ].join('\n');

  it('previews an import without writing', async () => {
    const res = await s.request('POST', '/products/import', {
      token,
      body: { csv, dry_run: true },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ dry_run: true, created: 1, updated: 1 });
    expect(res.body.errors).toEqual([expect.objectContaining({ row: 5 })]);
    const [count] =
      await sql`select count(*)::int as n from sellbase.products where store_id = ${s.storeId} and slug = 'gorra'`;
    expect(count?.n).toBe(0);
  });

  it('imports new products and updates existing ones by slug and SKU', async () => {
    const res = await s.request('POST', '/products/import', { token, body: { csv } });
    expect(res.body).toMatchObject({ dry_run: false, created: 1, updated: 1 });
    const gorra = res.body.products.find((p: { slug: string }) => p.slug === 'gorra');
    const product = await s.request('GET', `/products/${gorra.id}`, { token });
    expect(product.body).toMatchObject({ status: 'active', title: 'Gorra' });
    expect(product.body.variants.map((v: { title: string }) => v.title)).toEqual([
      'Negra',
      'Blanca',
    ]);
    expect(product.body.media[0].url).toBe('https://cdn.test/gorra.jpg');

    const taza = await s.request('GET', `/products/${mugProduct}`, { token });
    expect(taza.body.variants[0]).toMatchObject({ price_amount: 16000 });
    expect(taza.body.variants[0].inventory.on_hand).toBe(9);
    expect(
      taza.body.variants.filter((v: { status: string }) => v.status !== 'archived'),
    ).toHaveLength(1);
  });

  it('previews a bulk price change and applies it only with confirm', async () => {
    const body = {
      product_ids: [mugProduct],
      action: 'price',
      price: { mode: 'percent', value: -1000 },
    };
    const preview = await s.request('POST', '/products/bulk', { token, body });
    expect(preview.body).toMatchObject({
      applied: false,
      preview: [{ from_amount: 16000, to_amount: 14400 }],
    });
    let taza = await s.request('GET', `/products/${mugProduct}`, { token });
    expect(taza.body.variants[0].price_amount).toBe(16000);

    const applied = await s.request('POST', '/products/bulk', {
      token,
      body: { ...body, confirm: true },
    });
    expect(applied.body).toMatchObject({ applied: true, updated: 1 });
    taza = await s.request('GET', `/products/${mugProduct}`, { token });
    expect(taza.body.variants[0].price_amount).toBe(14400);
    const [audit] = await sql`
      select diff from sellbase.audit_log where action = 'variant.bulk_price' and store_id = ${s.storeId}`;
    expect(audit?.diff).toEqual({ from_amount: 16000, to_amount: 14400 });
  });

  it('archives and publishes in bulk, refusing negative prices', async () => {
    const archived = await s.request('POST', '/products/bulk', {
      token,
      body: { product_ids: [mugProduct], action: 'archive' },
    });
    expect(archived.body).toMatchObject({ applied: true, updated: 1 });
    await s.request('POST', '/products/bulk', {
      token,
      body: { product_ids: [mugProduct], action: 'publish' },
    });
    const taza = await s.request('GET', `/products/${mugProduct}`, { token });
    expect(taza.body.status).toBe('active');

    const negative = await s.request('POST', '/products/bulk', {
      token,
      body: {
        product_ids: [mugProduct],
        action: 'price',
        price: { mode: 'amount', value: -99999 },
      },
    });
    expect(negative.status).toBe(400);
    expect(negative.body.error.code).toBe('INVALID_AMOUNT');
  });
});
