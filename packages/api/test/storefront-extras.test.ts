import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJobs } from '../src/index.js';
import { createTestStore, sendWebhook, sql, type TestStore } from './helpers.js';

let s: TestStore;
let agent: string;
let tee: { id: string; variant: string };
let ebook: { id: string; variant: string };

async function buy(email: string, variants: string[]) {
  const cart = await s.request('POST', '/storefront/carts', { body: {} });
  for (const v of variants)
    await s.request('POST', `/storefront/carts/${cart.body.token}/items`, {
      body: { variant_id: v },
    });
  const checkout = await s.request('POST', '/storefront/checkout', {
    body: {
      cart_token: cart.body.token,
      email,
      shipping_rate_id: 'manual:flat',
      shipping_address: { line1: 'A', city: 'B', postal_code: '1', country: 'MX' },
      success_url: 'https://shop.test/gracias',
      cancel_url: 'https://shop.test/carrito',
    },
  });
  expect(checkout.status, JSON.stringify(checkout.body)).toBe(200);
  const id = checkout.body.checkout_session_id as string;
  const eventId = `evt_${randomUUID()}`;
  await sendWebhook(s, {
    id: eventId,
    data: {
      type: 'checkout.paid',
      provider_event_id: eventId,
      checkout_session_id: id,
      provider_payment_id: `pi_${randomUUID()}`,
      method: 'card',
      amount: s.payments.created.at(-1)?.amount_total ?? 0,
      currency: 'MXN',
      raw: {},
    },
  });
  await runJobs(s.deps, { storeId: s.storeId });
  return id;
}

beforeAll(async () => {
  s = await createTestStore();
  agent = await s.token();
  const t = await s.request('POST', '/products', {
    token: agent,
    body: {
      type: 'physical',
      title: 'Playera',
      status: 'active',
      variants: [{ price_amount: 34900, inventory: { on_hand: 10 } }],
    },
  });
  tee = { id: t.body.id, variant: t.body.variants[0].id };
  const e = await s.request('POST', '/products', {
    token: agent,
    body: { type: 'digital', title: 'Guía', status: 'active', variants: [{ price_amount: 19900 }] },
  });
  ebook = { id: e.body.id, variant: e.body.variants[0].id };
  await s.request('POST', `/variants/${ebook.variant}/digital-assets`, {
    token: agent,
    body: { file_name: 'guia.pdf', content_base64: 'JVBERg==', download_limit: 2 },
  });
});

afterAll(async () => {
  await sql.end();
});

describe('storefront collections', () => {
  it('lists collections with active products and gets one by slug', async () => {
    await s.request('POST', '/collections', {
      token: agent,
      body: { title: 'Novedades', product_ids: [tee.id, ebook.id] },
    });
    await s.request('POST', '/collections', { token: agent, body: { title: 'Vacía' } });
    const list = await s.request('GET', '/storefront/collections');
    expect(list.body.data).toEqual([
      { slug: 'novedades', title: 'Novedades', description: '', product_count: 2 },
    ]);
    const one = await s.request('GET', '/storefront/collections/novedades');
    expect(one.body.product_count).toBe(2);
    const missing = await s.request('GET', '/storefront/collections/nada');
    expect(missing.status).toBe(404);
  });
});

describe('order summary for the buyer', () => {
  const email = `buyer-${randomUUID()}@test.dev`;
  let checkoutId: string;

  beforeAll(async () => {
    checkoutId = await buy(email, [tee.variant, ebook.variant]);
  });

  it('the return page gets the order summary once paid', async () => {
    const res = await s.request('GET', `/storefront/checkout/${checkoutId}`);
    expect(res.body.status).toBe('paid');
    expect(res.body.order).toMatchObject({
      email: expect.stringMatching(/^b\*\*\*@test\.dev$/),
      payment_status: 'paid',
      has_downloads: true,
      items: expect.arrayContaining([
        expect.objectContaining({ title: 'Playera', fulfillment_type: 'shipment' }),
        expect.objectContaining({ title: 'Guía', fulfillment_type: 'digital' }),
      ]),
    });
    expect(JSON.stringify(res.body)).not.toContain('pi_'); // no payment ids
  });

  it('order lookup needs the right number and email, and shows tracking', async () => {
    const [order] = await sql<{ id: string; number: number }[]>`
      select id, number from sellbase.orders where email = ${email}`;
    await s.request('POST', `/orders/${order?.id}/fulfillments`, {
      token: agent,
      body: {
        carrier: 'Estafeta',
        tracking_number: 'EST123',
        tracking_url: 'https://track.test/EST123',
      },
    });
    const ok = await s.request('POST', '/storefront/orders/lookup', {
      body: { number: order?.number, email: email.toUpperCase() },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.shipments[0]).toMatchObject({ carrier: 'Estafeta', tracking_number: 'EST123' });
    const wrong = await s.request('POST', '/storefront/orders/lookup', {
      body: { number: order?.number, email: 'otro@test.dev' },
    });
    expect(wrong.status).toBe(404);
    const wrongNumber = await s.request('POST', '/storefront/orders/lookup', {
      body: { number: 987654, email },
    });
    // Same answer either way: it never tells which part was wrong.
    expect(wrongNumber.body.error).toEqual(wrong.body.error);
  });

  it('download info tells the buyer what the link gives and when it stops working', async () => {
    const mail = s.emails.find((m) => m.to === email);
    const token = /storefront\/downloads\/([^\s)"]+)/.exec(mail?.text ?? '')?.[1] ?? '';
    const info = await s.request('GET', `/storefront/downloads/${token}/info`);
    expect(info.body).toMatchObject({
      product_title: 'Guía',
      file_name: 'guia.pdf',
      status: 'ready',
      downloads_used: 0,
      download_limit: 2,
    });
    await s.request('GET', `/storefront/downloads/${token}`);
    await s.request('GET', `/storefront/downloads/${token}`);
    const used = await s.request('GET', `/storefront/downloads/${token}/info`);
    expect(used.body).toMatchObject({ status: 'limit_reached', downloads_used: 2 });
    const bad = await s.request('GET', `/storefront/downloads/${'x'.repeat(30)}/info`);
    expect(bad.status).toBe(404);
  });

  it('emails link to the store download page when it has one', async () => {
    await s.request('PATCH', '/store', {
      token: await s.staff('owner'),
      body: { settings: { download_page_url: 'https://tienda.test/descargas/{token}' } },
    });
    const other = `buyer-${randomUUID()}@test.dev`;
    await buy(other, [ebook.variant]);
    const mail = s.emails.find((m) => m.to === other);
    expect(mail?.text).toMatch(/https:\/\/tienda\.test\/descargas\/[A-Za-z0-9_-]{20,}/);
  });

  it('limits order lookups per IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await s.request('POST', '/storefront/orders/lookup', {
        body: { number: 999999, email: 'nadie@test.dev' },
        headers: { 'x-forwarded-for': '203.0.113.9' },
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((st) => st === 404)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
