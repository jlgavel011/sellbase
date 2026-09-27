import { describe, expect, it } from 'vitest';
import {
  checkoutLineItems,
  stripePayments,
  toStripeForm,
  verifyStripeSignature,
} from '../src/index.js';

async function sign(payload: string, secret: string, t: number) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  return `t=${t},v1=${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const baseInput = {
  checkout_session_id: 'sess-1',
  store_id: 'store-1',
  currency: 'MXN',
  amount_total: 90630,
  email: 'buyer@test.dev',
  lines: [
    { title: 'Playera', quantity: 2, total_amount: 62820 },
    { title: 'Guía', quantity: 1, total_amount: 17910 },
  ],
  shipping_amount: 9900,
  success_url: 'https://shop.test/ok',
  cancel_url: 'https://shop.test/no',
  expires_at: new Date('2026-01-01T00:15:00Z'),
  idempotency_key: 'sess-1',
};

describe('toStripeForm', () => {
  it('encodes nested objects and arrays', () => {
    const form = toStripeForm({ a: 1, b: { c: 'x', d: [{ e: true }] }, skip: undefined });
    expect(form.toString()).toBe('a=1&b%5Bc%5D=x&b%5Bd%5D%5B0%5D%5Be%5D=true');
  });
});

describe('checkoutLineItems', () => {
  it('sends discounted line totals so Stripe matches Sellbase exactly', () => {
    const items = checkoutLineItems(baseInput) as {
      price_data: { unit_amount: number; product_data: { name: string } };
    }[];
    expect(items.map((i) => i.price_data.unit_amount)).toEqual([62820, 17910]);
    expect(items[0]?.price_data.product_data.name).toBe('Playera × 2');
  });

  it('adds exclusive tax as its own line', () => {
    const items = checkoutLineItems({ ...baseInput, amount_total: 90630 + 825 });
    expect(items).toHaveLength(3);
  });
});

describe('verifyStripeSignature', () => {
  const secret = 'whsec_test';
  const payload = '{"id":"evt_1"}';

  it('accepts a valid signature', async () => {
    await expect(
      verifyStripeSignature(payload, await sign(payload, secret, 1000), secret, 1100),
    ).resolves.toBeUndefined();
  });

  it('rejects tampering, wrong secrets and old timestamps', async () => {
    const header = await sign(payload, secret, 1000);
    await expect(verifyStripeSignature('{"id":"evt_2"}', header, secret, 1000)).rejects.toThrow(
      'mismatch',
    );
    await expect(verifyStripeSignature(payload, header, 'whsec_other', 1000)).rejects.toThrow(
      'mismatch',
    );
    await expect(verifyStripeSignature(payload, header, secret, 2000)).rejects.toThrow('tolerance');
    await expect(verifyStripeSignature(payload, 'garbage', secret, 1000)).rejects.toThrow(
      'Malformed',
    );
  });
});

describe('stripePayments', () => {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      body: String(init.body ?? ''),
      headers: init.headers as Record<string, string>,
    });
    return new Response(
      JSON.stringify({
        id: 'cs_test_1',
        url: 'https://checkout.stripe.com/c/pay/cs_test_1',
        amount_total: 90630,
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const adapter = stripePayments({
    secretKey: 'sk_test_x',
    fetch: fakeFetch,
    now: () => new Date('2026-01-01T00:00:00Z'),
  });

  it('creates a redirect checkout with metadata, shipping and a 31 minute minimum expiry', async () => {
    const result = await adapter.createCheckout(baseInput);
    expect(result).toEqual({
      mode: 'redirect',
      provider_session_id: 'cs_test_1',
      url: 'https://checkout.stripe.com/c/pay/cs_test_1',
    });
    const form = new URLSearchParams(calls[0]?.body);
    expect(form.get('metadata[sellbase_checkout_session_id]')).toBe('sess-1');
    expect(form.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]')).toBe('9900');
    expect(form.get('payment_method_types[0]')).toBe('card');
    expect(Number(form.get('expires_at'))).toBe(Date.parse('2026-01-01T00:31:00Z') / 1000);
    expect(calls[0]?.headers['idempotency-key']).toBe('sess-1');
  });

  it('maps checkout events', () => {
    const object = {
      id: 'cs_1',
      payment_status: 'paid',
      amount_total: 90630,
      currency: 'mxn',
      payment_intent: 'pi_1',
      client_reference_id: 'sess-1',
      metadata: { sellbase_checkout_session_id: 'sess-1' },
      payment_method_types: ['card'],
    };
    expect(
      adapter.mapEvent({ id: 'evt_1', type: 'checkout.session.completed', data: { object } }),
    ).toMatchObject({
      type: 'checkout.paid',
      checkout_session_id: 'sess-1',
      provider_payment_id: 'pi_1',
      amount: 90630,
      currency: 'MXN',
      method: 'card',
    });
    expect(
      adapter.mapEvent({
        id: 'evt_2',
        type: 'checkout.session.completed',
        data: { object: { ...object, payment_status: 'unpaid', payment_method_types: ['oxxo'] } },
      }),
    ).toMatchObject({ type: 'checkout.pending', method: 'oxxo' });
    expect(
      adapter.mapEvent({ id: 'evt_3', type: 'checkout.session.expired', data: { object } }),
    ).toMatchObject({ type: 'checkout.expired' });
    expect(
      adapter.mapEvent({ id: 'evt_4', type: 'charge.succeeded', data: { object } }),
    ).toBeNull();
    expect(
      adapter.mapEvent({
        id: 'evt_5',
        type: 'checkout.session.completed',
        data: { object: { ...object, metadata: {}, client_reference_id: null } },
      }),
    ).toBeNull();
  });
});
