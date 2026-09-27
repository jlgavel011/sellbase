import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJobs } from '../src/index.js';
import { createTestStore, sendWebhook, sql, type TestStore } from './helpers.js';

let s: TestStore;
let token: string;
let service: string;
let ebook: string;
let slot: string;

async function webhook(data: Record<string, unknown>, id = `evt_${crypto.randomUUID()}`) {
  return sendWebhook(s, {
    id,
    data: { provider_event_id: id, method: 'card', currency: 'MXN', raw: {}, ...data },
  });
}

beforeAll(async () => {
  s = await createTestStore();
  token = await s.token();
  const product = await s.request('POST', '/products', {
    token,
    body: {
      type: 'service',
      title: 'Sesión de fotos',
      status: 'active',
      variants: [
        {
          price_amount: 80000,
          service: {
            duration_min: 60,
            location_type: 'in_person',
            deposit_amount: 20000,
            min_notice_min: 0,
          },
        },
      ],
    },
  });
  service = product.body.variants[0].id;
  await s.request('POST', '/resources', {
    token,
    body: {
      name: 'Estudio',
      rules: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        start_time: '08:00',
        end_time: '20:00',
      })),
      product_ids: [product.body.id],
    },
  });
  const e = await s.request('POST', '/products', {
    token,
    body: {
      type: 'digital',
      title: 'Guía de poses',
      status: 'active',
      variants: [{ price_amount: 10000 }],
    },
  });
  ebook = e.body.variants[0].id;
  await s.request('POST', `/variants/${ebook}/digital-assets`, {
    token,
    body: { file_name: 'poses.pdf', content_base64: 'JVBERg==' },
  });
  const availability = await s.request(
    'GET',
    `/storefront/availability?variant_id=${service}&from=${new Date(Date.now() + 2 * 86_400_000).toISOString()}`,
  );
  slot = availability.body.slots[0].starts_at;
});

afterAll(async () => {
  await sql.end();
});

describe('deposits', () => {
  let orderId: string;

  it('shows what is due now and charges only the deposit', async () => {
    const cart = await s.request('POST', '/storefront/carts', { body: {} });
    await s.request('POST', `/storefront/carts/${cart.body.token}/items`, {
      body: { variant_id: service, booking_slot: { starts_at: slot } },
    });
    const view = await s.request('POST', `/storefront/carts/${cart.body.token}/items`, {
      body: { variant_id: ebook },
    });
    expect(view.body.totals).toMatchObject({ total_amount: 90000, deposit_amount: 30000 }); // 20000 deposit + 10000 ebook

    const checkout = await s.request('POST', '/storefront/checkout', {
      body: {
        cart_token: cart.body.token,
        email: 'foto@test.dev',
        pay_mode: 'deposit',
        success_url: 'https://studio.test/ok',
        cancel_url: 'https://studio.test/no',
      },
    });
    expect(checkout.status, JSON.stringify(checkout.body)).toBe(200);
    const sent = s.payments.created.at(-1);
    expect(sent?.amount_total).toBe(30000);
    expect(sent?.lines.map((l) => [l.title, l.total_amount])).toEqual([
      ['Anticipo · Sesión de fotos', 20000],
      ['Guía de poses', 10000],
    ]);

    await webhook({
      type: 'checkout.paid',
      checkout_session_id: checkout.body.checkout_session_id,
      provider_payment_id: `pi_${crypto.randomUUID()}`,
      amount: 30000,
    });
    await runJobs(s.deps, { storeId: s.storeId });
    const orders = await s.request('GET', '/orders?limit=1', { token });
    orderId = orders.body.data[0].id;
    const order = await s.request('GET', `/orders/${orderId}`, { token });
    expect(order.body).toMatchObject({
      total_amount: 90000,
      amount_paid: 30000,
      payment_status: 'partially_paid',
      status: 'open',
    });
    expect(order.body.payments[0].kind).toBe('deposit');
    const [booking] = await sql<
      { status: string }[]
    >`select status from sellbase.bookings where order_id = ${orderId}`;
    expect(booking?.status).toBe('confirmed');
    const confirmation = s.emails.filter(
      (m) => m.to === 'foto@test.dev' && m.subject.includes('confirmado'),
    );
    expect(confirmation).toHaveLength(1);
    expect(confirmation[0]?.html).toContain('Tu cita');
  });

  it('refuses deposit mode when nothing has a deposit', async () => {
    const cart = await s.request('POST', '/storefront/carts', { body: {} });
    await s.request('POST', `/storefront/carts/${cart.body.token}/items`, {
      body: { variant_id: ebook },
    });
    const res = await s.request('POST', '/storefront/checkout', {
      body: {
        cart_token: cart.body.token,
        email: 'x@test.dev',
        pay_mode: 'deposit',
        success_url: 'https://a.test/ok',
        cancel_url: 'https://a.test/no',
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.hint).toContain('pay_mode "full"');
  });

  it('creates a balance link and records the balance once', async () => {
    const noUrl = await s.request('POST', `/orders/${orderId}/payment-link`, { token, body: {} });
    expect(noUrl.status).toBe(400);
    expect(noUrl.body.error.hint).toContain('site_url');

    const tooMuch = await s.request('POST', `/orders/${orderId}/payment-link`, {
      token,
      body: { amount: 99999999, success_url: 'https://studio.test/gracias' },
    });
    expect(tooMuch.status).toBe(400);

    const link = await s.request('POST', `/orders/${orderId}/payment-link`, {
      token,
      body: { success_url: 'https://studio.test/gracias' },
    });
    expect(link.status, JSON.stringify(link.body)).toBe(200);
    expect(link.body).toMatchObject({ amount: 60000, currency: 'MXN' });
    expect(s.payments.created.at(-1)).toMatchObject({ order_id: orderId, amount_total: 60000 });

    const paid = {
      type: 'order.balance_paid',
      order_id: orderId,
      provider_payment_id: `pi_balance_${crypto.randomUUID()}`,
      amount: 60000,
    };
    const first = await webhook(paid);
    expect(first.body.outcome).toBe('balance_recorded');
    await webhook(paid); // same payment delivered again under a new event id
    await runJobs(s.deps, { storeId: s.storeId });

    const order = await s.request('GET', `/orders/${orderId}`, { token });
    expect(order.body).toMatchObject({ amount_paid: 90000, payment_status: 'paid' });
    expect(order.body.payments.map((p: { kind: string }) => p.kind).sort()).toEqual([
      'balance',
      'deposit',
    ]);
    // Paying the balance unlocks the digital guide: the customer gets its download link.
    const emails = s.emails.filter(
      (m) => m.to === 'foto@test.dev' && m.subject.includes('confirmado'),
    );
    expect(emails).toHaveLength(2);
    expect(emails[1]?.html).toContain('/storefront/downloads/');
    expect(emails[0]?.html).not.toContain('/storefront/downloads/');

    const again = await s.request('POST', `/orders/${orderId}/payment-link`, {
      token,
      body: { success_url: 'https://studio.test/gracias' },
    });
    expect(again.status).toBe(400);
    expect(again.body.error.message).toContain('already paid');
  });
});
