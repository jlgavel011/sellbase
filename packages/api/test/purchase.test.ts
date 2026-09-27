import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJobs } from '../src/index.js';
import { createTestStore, sendWebhook, sql, type TestStore } from './helpers.js';

/**
 * End-to-end purchase through the API, webhooks and jobs against the local database:
 * catalog → cart → discounts → checkout (reservation) → paid webhook → order →
 * digital delivery + confirmation email → download.
 */
let s: TestStore;
let agent: string;
let tee: { id: string; variant: string };
let ebook: { id: string; variant: string };

beforeAll(async () => {
  s = await createTestStore({ shipping: { flat_rate_amount: 9900, free_over_amount: 200000 } });
  agent = await s.token();

  const t = await s.request('POST', '/products', {
    token: agent,
    body: {
      type: 'physical',
      title: 'Playera Negra',
      status: 'active',
      variants: [
        {
          price_amount: 34900,
          sku: 'TEE-M',
          inventory: { on_hand: 5 },
          physical: { weight_g: 200, length_cm: 30, width_cm: 25, height_cm: 2 },
        },
      ],
    },
  });
  expect(t.status, JSON.stringify(t.body)).toBe(200);
  tee = { id: t.body.id, variant: t.body.variants[0].id };

  const e = await s.request('POST', '/products', {
    token: agent,
    body: {
      type: 'digital',
      title: 'Guía PDF',
      status: 'active',
      variants: [{ price_amount: 19900 }],
    },
  });
  ebook = { id: e.body.id, variant: e.body.variants[0].id };
  await sql`
    insert into sellbase.digital_assets (store_id, variant_id, storage_path, file_name, download_limit)
    values (${s.storeId}, ${ebook.variant}, ${`${s.storeId}/guia.pdf`}, 'guia.pdf', 2)`;
  await sql`
    insert into sellbase.discounts (store_id, code, kind, value, min_subtotal_amount)
    values (${s.storeId}, 'HOLA10', 'percent', 1000, null), (${s.storeId}, 'MAYOREO', 'fixed', 5000, 500000)`;
});

afterAll(async () => {
  await sql.end();
});

describe('storefront catalog', () => {
  it('lists active products with prices and images', async () => {
    const res = await s.request('GET', '/storefront/products');
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: { slug: string }) => p.slug).sort()).toEqual([
      'guia-pdf',
      'playera-negra',
    ]);
  });

  it('returns product detail with availability', async () => {
    const res = await s.request('GET', '/storefront/products/playera-negra');
    expect(res.body.variants[0]).toMatchObject({
      sku: 'TEE-M',
      available: true,
      available_quantity: 5,
      price_amount: 34900,
    });
  });

  it('hides drafts', async () => {
    await s.request('POST', '/products', {
      token: agent,
      body: { type: 'digital', title: 'Borrador', variants: [{ price_amount: 100 }] },
    });
    const res = await s.request('GET', '/storefront/products/borrador');
    expect(res.status).toBe(404);
    expect(res.body.error.hint).toContain('GET /storefront/products');
  });
});

describe('purchase', () => {
  let cartToken: string;
  let sessionId: string;
  let orderId: string;

  it('builds a cart with server-side totals', async () => {
    const created = await s.request('POST', '/storefront/carts', { body: {} });
    cartToken = created.body.token;
    await s.request('POST', `/storefront/carts/${cartToken}/items`, {
      body: { variant_id: tee.variant, quantity: 1 },
    });
    await s.request('POST', `/storefront/carts/${cartToken}/items`, {
      body: { variant_id: tee.variant, quantity: 1 },
    });
    const cart = await s.request('POST', `/storefront/carts/${cartToken}/items`, {
      body: { variant_id: ebook.variant },
    });
    expect(cart.status).toBe(200);
    expect(cart.body.items.map((i: { quantity: number }) => i.quantity)).toEqual([2, 1]);
    expect(cart.body.totals).toMatchObject({
      subtotal_amount: 89700,
      total_amount: 89700,
      tax_mode: 'inclusive',
    });
    expect(cart.body.requires_shipping).toBe(true);
  });

  it('applies a valid code and explains invalid ones', async () => {
    const bad = await s.request('POST', `/storefront/carts/${cartToken}/discounts`, {
      body: { code: 'NOPE' },
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('DISCOUNT_NOT_APPLICABLE');

    const minimum = await s.request('POST', `/storefront/carts/${cartToken}/discounts`, {
      body: { code: 'mayoreo' },
    });
    expect(minimum.status).toBe(422);
    expect(minimum.body.error.code).toBe('DISCOUNT_MIN_SUBTOTAL_NOT_MET');

    const ok = await s.request('POST', `/storefront/carts/${cartToken}/discounts`, {
      body: { code: 'hola10' },
    });
    expect(ok.body.discount_codes).toEqual(['HOLA10']);
    expect(ok.body.totals).toMatchObject({ discount_amount: 8970, total_amount: 80730 });
  });

  it('quotes shipping', async () => {
    const res = await s.request('POST', `/storefront/carts/${cartToken}/shipping-rates`, {
      body: {},
    });
    expect(res.body.rates).toEqual([expect.objectContaining({ id: 'manual:flat', amount: 9900 })]);
  });

  it('requires a shipping choice for physical items', async () => {
    const res = await s.request('POST', '/storefront/checkout', {
      body: {
        cart_token: cartToken,
        email: 'buyer@test.dev',
        success_url: 'https://shop.test/ok',
        cancel_url: 'https://shop.test/no',
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.hint).toContain('shipping-rates');
  });

  it('starts checkout, recomputes totals and reserves stock', async () => {
    const res = await s.request('POST', '/storefront/checkout', {
      body: {
        cart_token: cartToken,
        email: 'Buyer@Test.dev',
        shipping_rate_id: 'manual:flat',
        shipping_address: {
          line1: 'Av. Reforma 1',
          city: 'CDMX',
          postal_code: '06600',
          country: 'MX',
        },
        success_url: 'https://shop.test/ok',
        cancel_url: 'https://shop.test/no',
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.mode).toBe('redirect');
    sessionId = res.body.checkout_session_id;
    expect(s.payments.created.at(-1)).toMatchObject({
      checkout_session_id: sessionId,
      amount_total: 80730 + 9900,
    });
    const product = await s.request('GET', `/products/${tee.id}`, { token: agent });
    expect(product.body.variants[0].inventory).toMatchObject({ on_hand: 5, reserved: 2 });
  });

  it('rejects webhooks with a bad signature', async () => {
    const res = await sendWebhook(s, { id: 'evt_bad', data: null }, 'wrong');
    expect(res.status).toBe(401);
  });

  it('creates the order only from the paid webhook, once', async () => {
    const eventId = `evt_${crypto.randomUUID()}`;
    const paid = {
      type: 'checkout.paid',
      provider_event_id: eventId,
      checkout_session_id: sessionId,
      provider_payment_id: `pi_${crypto.randomUUID()}`,
      method: 'card',
      amount: 90630,
      currency: 'MXN',
      raw: {},
    };
    const first = await sendWebhook(s, { id: eventId, data: paid });
    expect(first.body.outcome).toBe('order_placed');
    const again = await sendWebhook(s, { id: eventId, data: paid });
    expect(again.body.outcome).toBe('duplicate');

    const orders = await s.request('GET', '/orders', { token: agent });
    expect(orders.body.data).toHaveLength(1);
    orderId = orders.body.data[0].id;
    expect(orders.body.data[0]).toMatchObject({
      email: 'buyer@test.dev',
      total_amount: 90630,
      payment_status: 'paid',
      status: 'open',
    });
    const product = await s.request('GET', `/products/${tee.id}`, { token: agent });
    expect(product.body.variants[0].inventory).toMatchObject({ on_hand: 3, reserved: 0 });
  });

  it('delivers digital files and emails the buyer', async () => {
    const summary = await runJobs(s.deps, { storeId: s.storeId });
    expect(summary.failed).toBe(0);
    const email = s.emails.find((m) => m.to === 'buyer@test.dev');
    expect(email?.subject).toContain('confirmado');
    const link = /https:\/\/\S+\/storefront\/downloads\/(\S+)/.exec(email?.text ?? '');
    expect(link).not.toBeNull();

    const order = await s.request('GET', `/orders/${orderId}`, { token: agent });
    expect(order.body.fulfillment_status).toBe('partially_fulfilled'); // the tee still has to ship
    expect(order.body.events.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(['order.created', 'digital.granted', 'notification.sent']),
    );

    const token = link?.[1] ?? '';
    const d1 = await s.request('GET', `/storefront/downloads/${token}`);
    expect(d1.status).toBe(302);
    await s.request('GET', `/storefront/downloads/${token}`);
    const d3 = await s.request('GET', `/storefront/downloads/${token}`);
    expect(d3.status).toBe(403);
    expect(d3.body.error.message).toContain('download limit');
  });

  it('does not send the email twice when jobs run again', async () => {
    const before = s.emails.length;
    await runJobs(s.deps, { storeId: s.storeId });
    expect(s.emails.length).toBe(before);
  });

  it('locks the converted cart', async () => {
    const res = await s.request('POST', `/storefront/carts/${cartToken}/items`, {
      body: { variant_id: tee.variant },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.hint).toContain('POST /storefront/carts');
  });
});

describe('stock limits', () => {
  it('refuses checkout beyond available stock', async () => {
    const cart = await s.request('POST', '/storefront/carts', { body: {} });
    await s.request('POST', `/storefront/carts/${cart.body.token}/items`, {
      body: { variant_id: tee.variant, quantity: 4 },
    });
    const res = await s.request('POST', '/storefront/checkout', {
      body: {
        cart_token: cart.body.token,
        email: 'x@test.dev',
        shipping_rate_id: 'manual:flat',
        shipping_address: { line1: 'A', city: 'B', postal_code: '1', country: 'MX' },
        success_url: 'https://shop.test/ok',
        cancel_url: 'https://shop.test/no',
      },
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'OUT_OF_STOCK' });
    expect(res.body.error.hint).toContain('Lower the quantity');
  });
});
