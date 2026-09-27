import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJobs } from '../src/index.js';
import { createTestStore, sendWebhook, sql, type TestStore } from './helpers.js';

let s: TestStore;
let token: string;
let teeVariant: string;

/** A paid order with 3 T-shirts and 1 e-book, created through checkout + webhook. */
async function paidOrder() {
  const cart = await s.request('POST', '/storefront/carts', { body: {} });
  const ebook = await s.request('GET', '/storefront/products/ebook-acciones');
  await s.request('POST', `/storefront/carts/${cart.body.token}/items`, {
    body: { variant_id: teeVariant, quantity: 3 },
  });
  await s.request('POST', `/storefront/carts/${cart.body.token}/items`, {
    body: { variant_id: ebook.body.variants[0].id },
  });
  const checkout = await s.request('POST', '/storefront/checkout', {
    body: {
      cart_token: cart.body.token,
      email: 'buyer@test.dev',
      shipping_rate_id: 'manual:flat',
      shipping_address: { line1: 'A 1', city: 'CDMX', postal_code: '06600', country: 'MX' },
      success_url: 'https://shop.test/ok',
      cancel_url: 'https://shop.test/no',
    },
  });
  const total = s.payments.created.at(-1)?.amount_total ?? 0;
  const eventId = `evt_${crypto.randomUUID()}`;
  await sendWebhook(s, {
    id: eventId,
    data: {
      type: 'checkout.paid',
      provider_event_id: eventId,
      checkout_session_id: checkout.body.checkout_session_id,
      provider_payment_id: `pi_${crypto.randomUUID()}`,
      method: 'card',
      amount: total,
      currency: 'MXN',
      raw: {},
    },
  });
  await runJobs(s.deps);
  const orders = await s.request('GET', '/orders?limit=1', { token });
  return { id: orders.body.data[0].id as string, total };
}

const stock = async () =>
  (await s.request('GET', '/storefront/products/playera-acciones')).body.variants[0]
    .available_quantity;

beforeAll(async () => {
  s = await createTestStore();
  token = await s.token([
    ...(await import('@sellbase/core')).DEFAULT_AGENT_SCOPES,
    'refunds:write',
  ]);
  const tee = await s.request('POST', '/products', {
    token,
    body: {
      type: 'physical',
      title: 'Playera Acciones',
      status: 'active',
      variants: [{ price_amount: 30000, inventory: { on_hand: 20 } }],
    },
  });
  teeVariant = tee.body.variants[0].id;
  const ebook = await s.request('POST', '/products', {
    token,
    body: {
      type: 'digital',
      title: 'Ebook Acciones',
      status: 'active',
      variants: [{ price_amount: 10000 }],
    },
  });
  await s.request('POST', `/variants/${ebook.body.variants[0].id}/digital-assets`, {
    token,
    body: { file_name: 'e.pdf', content_base64: 'JVBERg==' },
  });
});

afterAll(async () => {
  await sql.end();
});

describe('fulfill', () => {
  it('ships part, then the rest, completing the order and emailing tracking', async () => {
    const { id } = await paidOrder();
    const detail = await s.request('GET', `/orders/${id}`, { token });
    const tee = detail.body.items.find(
      (i: { fulfillment_type: string }) => i.fulfillment_type === 'shipment',
    );

    const partial = await s.request('POST', `/orders/${id}/fulfillments`, {
      token,
      body: {
        items: [{ order_item_id: tee.id, quantity: 1 }],
        carrier: 'Estafeta',
        tracking_number: 'EST1',
        tracking_url: 'https://track.test/EST1',
      },
    });
    expect(partial.status, JSON.stringify(partial.body)).toBe(200);
    expect(partial.body.fulfillment_status).toBe('partially_fulfilled');
    expect(
      partial.body.fulfillments.find((f: { type: string }) => f.type === 'shipment').shipment,
    ).toMatchObject({ carrier: 'Estafeta', tracking_number: 'EST1' });

    const tooMany = await s.request('POST', `/orders/${id}/fulfillments`, {
      token,
      body: { items: [{ order_item_id: tee.id, quantity: 5 }] },
    });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.hint).toContain('quantity ≤ 2');

    const rest = await s.request('POST', `/orders/${id}/fulfillments`, { token, body: {} });
    expect(rest.body).toMatchObject({ fulfillment_status: 'fulfilled', status: 'completed' });

    await runJobs(s.deps);
    const shipped = s.emails.filter((m) => m.subject.includes('va en camino'));
    expect(shipped).toHaveLength(2);
    expect(shipped[0]?.html).toContain('https://track.test/EST1');

    const nothing = await s.request('POST', `/orders/${id}/fulfillments`, { token, body: {} });
    expect(nothing.status).toBe(409);
  });
});

describe('refund', () => {
  it('refunds partially, refuses more than was paid, and never twice on retry', async () => {
    const { id, total } = await paidOrder();
    const first = await s.request('POST', `/orders/${id}/refunds`, {
      token,
      body: { amount: 10000, reason: 'ebook no descargado', confirm: true },
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({
      amount_refunded: 10000,
      payment_status: 'partially_refunded',
    });
    expect(first.body.refunds[0]).toMatchObject({ amount: 10000, status: 'succeeded' });

    const tooMuch = await s.request('POST', `/orders/${id}/refunds`, {
      token,
      body: { amount: total, reason: 'x', confirm: true },
    });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.details.refundable).toBe(total - 10000);

    const key = crypto.randomUUID();
    const before = s.payments.refunds.length;
    const rest = await s.request('POST', `/orders/${id}/refunds`, {
      token,
      body: { reason: 'resto', confirm: true },
      headers: { 'idempotency-key': key },
    });
    const retry = await s.request('POST', `/orders/${id}/refunds`, {
      token,
      body: { reason: 'resto', confirm: true },
      headers: { 'idempotency-key': key },
    });
    expect(retry.body.amount_refunded).toBe(rest.body.amount_refunded);
    expect(s.payments.refunds.length - before).toBe(1);
    expect(rest.body.payment_status).toBe('refunded');

    await runJobs(s.deps);
    expect(
      s.emails.some((m) => m.subject.includes('Reembolso') && m.text.includes('$100.00')),
    ).toBe(true);
  });

  it('requires confirm and the refunds:write scope', async () => {
    const { id } = await paidOrder();
    const unconfirmed = await s.request('POST', `/orders/${id}/refunds`, {
      token,
      body: { reason: 'x' },
    });
    expect(unconfirmed.status).toBe(400);
    const agent = await s.token();
    const denied = await s.request('POST', `/orders/${id}/refunds`, {
      token: agent,
      body: { reason: 'x', confirm: true },
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error.details.required_scope).toBe('refunds:write');
  });
});

describe('cancel', () => {
  it('cancels with refund and restock, revokes downloads and emails the customer', async () => {
    const before = await stock();
    const { id, total } = await paidOrder();
    expect(await stock()).toBe(before - 3);

    const res = await s.request('POST', `/orders/${id}/cancel`, {
      token,
      body: { reason: 'cliente se arrepintió', refund: true, confirm: true },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      status: 'cancelled',
      payment_status: 'refunded',
      amount_refunded: total,
      cancel_reason: 'cliente se arrepintió',
    });
    expect(await stock()).toBe(before);

    const [grant] = await sql<
      { expired: boolean }[]
    >`select expires_at <= now() as expired from sellbase.digital_grants where order_id = ${id}`;
    expect(grant?.expired).toBe(true);

    await runJobs(s.deps);
    const email = s.emails.find((m) => m.subject.includes('cancelado'));
    expect(email?.text).toContain('reembolsamos');

    const again = await s.request('POST', `/orders/${id}/cancel`, {
      token,
      body: { reason: 'x', confirm: true },
    });
    expect(again.status).toBe(409);
  });

  it('agents without refunds:write can cancel but not refund', async () => {
    const { id } = await paidOrder();
    const agent = await s.token();
    const res = await s.request('POST', `/orders/${id}/cancel`, {
      token: agent,
      body: { reason: 'x', refund: true, confirm: true },
    });
    expect(res.status).toBe(403);
    const ok = await s.request('POST', `/orders/${id}/cancel`, {
      token: agent,
      body: { reason: 'x', confirm: true },
    });
    expect(ok.body.status).toBe('cancelled');
  });
});

describe('notes and notifications', () => {
  it('adds notes to the timeline and resends the confirmation', async () => {
    const { id } = await paidOrder();
    const note = await s.request('POST', `/orders/${id}/notes`, {
      token,
      body: { note: 'Regalo: sin factura' },
    });
    expect(note.body.notes).toContain('Regalo: sin factura');
    expect(note.body.events.some((e: { type: string }) => e.type === 'note')).toBe(true);

    const count = s.emails.filter((m) => m.subject.includes('confirmado')).length;
    const resend = await s.request('POST', `/orders/${id}/notifications`, {
      token,
      body: { template: 'order_confirmation' },
    });
    expect(resend.body).toMatchObject({ queued: true, to: 'buyer@test.dev' });
    await runJobs(s.deps);
    expect(s.emails.filter((m) => m.subject.includes('confirmado')).length).toBe(count + 1);
  });
});
