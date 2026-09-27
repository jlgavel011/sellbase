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
      adapter.mapEvent({
        id: 'evt_3b',
        type: 'checkout.session.async_payment_failed',
        data: { object: { ...object, payment_status: 'unpaid' } },
      }),
    ).toMatchObject({ type: 'payment.failed', checkout_session_id: 'sess-1' });
    expect(
      adapter.mapEvent({
        id: 'evt_3c',
        type: 'checkout.session.async_payment_succeeded',
        data: { object },
      }),
    ).toMatchObject({ type: 'checkout.paid', checkout_session_id: 'sess-1' });
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

  it('maps balance payments on existing orders', () => {
    const object = {
      id: 'cs_2',
      payment_status: 'paid',
      amount_total: 50000,
      currency: 'mxn',
      payment_intent: 'pi_2',
      client_reference_id: 'order-1',
      metadata: { sellbase_order_id: 'order-1', sellbase_payment_kind: 'balance' },
      payment_method_types: ['card'],
    };
    expect(
      adapter.mapEvent({ id: 'evt_6', type: 'checkout.session.completed', data: { object } }),
    ).toMatchObject({
      type: 'order.balance_paid',
      order_id: 'order-1',
      amount: 50000,
      currency: 'MXN',
    });
    expect(
      adapter.mapEvent({ id: 'evt_7', type: 'checkout.session.expired', data: { object } }),
    ).toBeNull();
  });
});

describe('live mode helpers', () => {
  function mockStripe(routes: Record<string, (body: URLSearchParams) => unknown>) {
    const calls: { method: string; path: string; body: URLSearchParams; version: string }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const path = url.replace('https://api.stripe.com/v1', '');
      const method = init.method ?? 'GET';
      const body = new URLSearchParams(String(init.body ?? ''));
      calls.push({
        method,
        path,
        body,
        version: (init.headers as Record<string, string>)['stripe-version'] ?? '',
      });
      const handler = routes[`${method} ${path}`];
      if (!handler)
        return new Response(JSON.stringify({ error: { message: 'no route' } }), { status: 404 });
      return new Response(JSON.stringify(handler(body)), { status: 200 });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it('reads the account, knows its mode and pins the API version', async () => {
    const { calls, fetchImpl } = mockStripe({
      'GET /account': () => ({
        id: 'acct_1',
        country: 'MX',
        default_currency: 'mxn',
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: true,
        business_profile: { name: 'Tienda Real' },
      }),
    });
    const live = stripePayments({ secretKey: 'sk_live_abc', fetch: fetchImpl });
    expect(live.mode?.()).toBe('live');
    expect(await live.account?.()).toMatchObject({
      name: 'Tienda Real',
      default_currency: 'MXN',
      mode: 'live',
      charges_enabled: false,
    });
    expect((await live.test()).message).toContain('live charges are not enabled');
    expect(calls[0]?.version).toBe('2024-06-20');
    expect(stripePayments({ secretKey: 'rk_test_x', fetch: fetchImpl }).mode?.()).toBe('test');
  });

  it('creates the webhook endpoint, or replaces it when the secret is lost', async () => {
    const url = 'https://p.supabase.co/functions/v1/sellbase-webhooks/stripe';
    let endpoints: { id: string; url: string }[] = [];
    const { calls, fetchImpl } = mockStripe({
      'GET /webhook_endpoints?limit=100': () => ({ data: endpoints }),
      'POST /webhook_endpoints': (b) => {
        endpoints = [{ id: 'we_2', url: b.get('url') ?? '' }];
        return { id: 'we_2', secret: 'whsec_new' };
      },
      'DELETE /webhook_endpoints/we_1': () => ({ deleted: true }),
      'POST /webhook_endpoints/we_2': () => ({ id: 'we_2' }),
    });
    const stripe = stripePayments({ secretKey: 'sk_live_abc', fetch: fetchImpl });

    endpoints = [{ id: 'we_1', url }];
    expect(await stripe.ensureWebhook?.(url, { haveSecret: false })).toEqual({
      endpoint_id: 'we_2',
      secret: 'whsec_new',
      created: true,
    });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain('DELETE /webhook_endpoints/we_1');
    const created = calls.find((c) => c.method === 'POST' && c.path === '/webhook_endpoints');
    expect(created?.body.getAll('enabled_events[0]')).toEqual(['checkout.session.completed']);
    expect(created?.body.get('api_version')).toBe('2024-06-20');

    expect(await stripe.ensureWebhook?.(url, { haveSecret: true })).toEqual({
      endpoint_id: 'we_2',
      secret: null,
      created: false,
    });
  });

  it('maps a paid live check and tags its checkout', async () => {
    const stripe = stripePayments({ secretKey: 'sk_live_abc' });
    const mapped = stripe.mapEvent({
      id: 'evt_1',
      type: 'checkout.session.completed',
      livemode: true,
      data: {
        object: {
          id: 'cs_1',
          payment_status: 'paid',
          amount_total: 1000,
          currency: 'mxn',
          payment_intent: 'pi_1',
          client_reference_id: 'chk-1',
          metadata: { sellbase_payment_kind: 'live_check', sellbase_live_check_id: 'chk-1' },
        },
      },
    });
    expect(mapped).toEqual({
      type: 'live_check.paid',
      provider_event_id: 'evt_1',
      live_check_id: 'chk-1',
      provider_payment_id: 'pi_1',
      amount: 1000,
      currency: 'MXN',
    });
  });
});
