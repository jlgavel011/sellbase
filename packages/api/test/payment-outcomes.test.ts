import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJobs } from '../src/index.js';
import { createTestStore, sendWebhook, sql, type TestStore } from './helpers.js';

/**
 * What can happen between "Pay" and the order (SPEC §8): duplicated webhooks, the buyer
 * returning before or after the webhook, rejected payments and sessions that expire.
 */
let s: TestStore;
let agent: string;
let productId: string;
let variantId: string;

async function startCheckout(quantity = 2) {
  const cart = await s.request('POST', '/storefront/carts', { body: {} });
  await s.request('POST', `/storefront/carts/${cart.body.token}/items`, {
    body: { variant_id: variantId, quantity },
  });
  const res = await s.request('POST', '/storefront/checkout', {
    body: {
      cart_token: cart.body.token,
      email: `buyer-${randomUUID()}@test.dev`,
      shipping_rate_id: 'manual:flat',
      shipping_address: { line1: 'A', city: 'B', postal_code: '1', country: 'MX' },
      success_url: 'https://shop.test/gracias?ref=ads',
      cancel_url: 'https://shop.test/carrito',
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const created = s.payments.created.at(-1);
  return { id: res.body.checkout_session_id as string, amount: created?.amount_total ?? 0 };
}

const paidEvent = (sessionId: string, amount: number, eventId = `evt_${randomUUID()}`) => ({
  id: eventId,
  data: {
    type: 'checkout.paid',
    provider_event_id: eventId,
    checkout_session_id: sessionId,
    provider_payment_id: `pi_${randomUUID()}`,
    method: 'card',
    amount,
    currency: 'MXN',
    raw: {},
  },
});

async function stock() {
  const p = await s.request('GET', `/products/${productId}`, { token: agent });
  return p.body.variants[0].inventory as { on_hand: number; reserved: number };
}

const status = async (id: string) => (await s.request('GET', `/storefront/checkout/${id}`)).body;

const ordersFor = async (sessionId: string) =>
  sql`select id from sellbase.orders where checkout_session_id = ${sessionId}`;

beforeAll(async () => {
  s = await createTestStore();
  agent = await s.token();
  const p = await s.request('POST', '/products', {
    token: agent,
    body: {
      type: 'physical',
      title: 'Taza',
      status: 'active',
      variants: [{ price_amount: 15000, inventory: { on_hand: 10 } }],
    },
  });
  productId = p.body.id;
  variantId = p.body.variants[0].id;
});

afterAll(async () => {
  await sql.end();
});

describe('duplicate webhooks', () => {
  it('creates one order for the same event, and for a second event of the same payment', async () => {
    const { id, amount } = await startCheckout();
    const event = paidEvent(id, amount);
    expect((await sendWebhook(s, event)).body.outcome).toBe('order_placed');
    expect((await sendWebhook(s, event)).body.outcome).toBe('duplicate');
    // Stripe can also send checkout.session.completed and async_payment_succeeded.
    expect((await sendWebhook(s, paidEvent(id, amount))).body.outcome).toBe('order_placed');
    expect(await ordersFor(id)).toHaveLength(1);
    expect(await stock()).toEqual(expect.objectContaining({ on_hand: 8, reserved: 0 }));
    await runJobs(s.deps, { storeId: s.storeId });
    const [payments] = await sql`
      select count(*)::int as n from sellbase.payments p join sellbase.orders o on o.id = p.order_id
       where o.checkout_session_id = ${id}`;
    expect(payments?.n).toBe(1);
  });
});

describe('return page and webhook order', () => {
  it('tells the return page which checkout it was, keeping its own query', async () => {
    const { id } = await startCheckout(1);
    const url = new URL(s.payments.created.at(-1)?.success_url ?? '');
    expect(url.searchParams.get('sellbase_checkout')).toBe(id);
    expect(url.searchParams.get('ref')).toBe('ads');
    await sql`select sellbase.release_checkout_session(${id})`;
  });

  it('buyer returns before the webhook: pending, then paid once it arrives', async () => {
    const { id, amount } = await startCheckout(1);
    expect(await status(id)).toEqual({ checkout_session_id: id, status: 'pending', order: null });
    await sendWebhook(s, paidEvent(id, amount));
    const after = await status(id);
    expect(after.status).toBe('paid');
    expect(after.order.number).toBeGreaterThan(0);
    expect(after.order.email).toMatch(/^b\*\*\*@test\.dev$/);
  });

  it('webhook arrives before the buyer returns: the order is already there', async () => {
    const { id, amount } = await startCheckout(1);
    await sendWebhook(s, paidEvent(id, amount));
    expect((await status(id)).status).toBe('paid');
    expect(await ordersFor(id)).toHaveLength(1);
  });

  it('answers 404 with a hint for unknown checkouts', async () => {
    const res = await s.request('GET', `/storefront/checkout/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.body.error.hint).toContain('sellbase_checkout');
  });
});

describe('rejected payments', () => {
  it('a failed payment creates no order and gives the stock back', async () => {
    const before = await stock();
    const { id } = await startCheckout(3);
    expect(await stock()).toMatchObject({ reserved: before.reserved + 3 });
    const eventId = `evt_${randomUUID()}`;
    const res = await sendWebhook(s, {
      id: eventId,
      data: {
        type: 'payment.failed',
        provider_event_id: eventId,
        checkout_session_id: id,
        reason: 'card_declined',
      },
    });
    expect(res.body.outcome).toBe('released');
    expect(await ordersFor(id)).toHaveLength(0);
    expect(await stock()).toEqual(before);
    expect((await status(id)).status).toBe('expired');
  });

  it('a declined card (no webhook) keeps the hold until the session expires', async () => {
    const before = await stock();
    const { id } = await startCheckout(1);
    await runJobs(s.deps, { storeId: s.storeId });
    expect(await stock()).toMatchObject({ reserved: before.reserved + 1 });
    expect((await status(id)).status).toBe('pending');
    await sql`select sellbase.release_checkout_session(${id})`;
  });
});

describe('expired sessions', () => {
  it('the expiry webhook releases the reserved stock', async () => {
    const before = await stock();
    const { id } = await startCheckout(2);
    const eventId = `evt_${randomUUID()}`;
    const res = await sendWebhook(s, {
      id: eventId,
      data: { type: 'checkout.expired', provider_event_id: eventId, checkout_session_id: id },
    });
    expect(res.body.outcome).toBe('released');
    expect(await stock()).toEqual(before);
    expect((await status(id)).status).toBe('expired');
  });

  it('the scheduled job releases sessions past their expiry even without a webhook', async () => {
    const before = await stock();
    const { id } = await startCheckout(2);
    await sql`update sellbase.checkout_sessions set expires_at = now() - interval '1 minute' where id = ${id}`;
    await runJobs(s.deps, { storeId: s.storeId });
    expect(await stock()).toEqual(before);
    expect((await status(id)).status).toBe('expired');
  });

  it('a payment that lands after expiry still becomes an order (the buyer paid)', async () => {
    const { id, amount } = await startCheckout(1);
    const eventId = `evt_${randomUUID()}`;
    await sendWebhook(s, {
      id: eventId,
      data: { type: 'checkout.expired', provider_event_id: eventId, checkout_session_id: id },
    });
    const before = await stock();
    expect((await sendWebhook(s, paidEvent(id, amount))).body.outcome).toBe('order_placed');
    expect(await ordersFor(id)).toHaveLength(1);
    expect(await stock()).toMatchObject({ on_hand: before.on_hand - 1, reserved: before.reserved });
  });
});
