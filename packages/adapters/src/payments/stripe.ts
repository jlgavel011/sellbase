import {
  sellbaseError,
  type CreateCheckoutInput,
  type NormalizedPaymentEvent,
  type PaymentMethod,
  type PaymentsAdapter,
  type ProviderEvent,
} from '@sellbase/core';

/**
 * Stripe payments over the REST API with fetch (no SDK), so the same code runs in Deno
 * Edge Functions, Node and workers. Phase 1: redirect to Stripe Checkout with cards
 * (Apple Pay / Google Pay come with cards). OXXO and other deferred methods: Phase 2.
 */

const API = 'https://api.stripe.com/v1';
/** Stripe Checkout sessions must live at least 30 minutes. */
const MIN_SESSION_MS = 31 * 60_000;
/** Reject webhook timestamps older than this (replay protection). */
const WEBHOOK_TOLERANCE_S = 300;

type FormValue =
  string | number | boolean | null | undefined | FormValue[] | { [key: string]: FormValue };

/** Encodes nested objects the way Stripe expects: a[b][0][c]=1. */
export function toStripeForm(value: Record<string, FormValue>): URLSearchParams {
  const params = new URLSearchParams();
  const walk = (prefix: string, v: FormValue) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((item, i) => walk(`${prefix}[${i}]`, item));
    else if (typeof v === 'object')
      for (const [k, inner] of Object.entries(v)) walk(`${prefix}[${k}]`, inner);
    else params.append(prefix, String(v));
  };
  for (const [key, v] of Object.entries(value)) walk(key, v);
  return params;
}

interface StripeError {
  error?: { message?: string; code?: string; type?: string };
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verifies a `Stripe-Signature` header (t=…,v1=…) against the raw body. */
export async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  nowSeconds: number,
) {
  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const [k, ...rest] = kv.split('=');
      return [k?.trim() ?? '', rest.join('=')];
    }),
  );
  const timestamp = Number(parts.t);
  const signatures = header
    .split(',')
    .filter((kv) => kv.trim().startsWith('v1='))
    .map((kv) => kv.trim().slice(3));
  if (!timestamp || signatures.length === 0) throw new Error('Malformed Stripe-Signature header');
  if (Math.abs(nowSeconds - timestamp) > WEBHOOK_TOLERANCE_S)
    throw new Error('Webhook timestamp outside tolerance');
  const expected = await hmacHex(secret, `${timestamp}.${payload}`);
  if (!signatures.some((s) => timingSafeEqual(s, expected)))
    throw new Error('Webhook signature mismatch');
}

/** Line items that add up exactly to `amount_total` (discounts and tax already applied). */
export function checkoutLineItems(input: CreateCheckoutInput) {
  const currency = input.currency.toLowerCase();
  // Each line is sent as one item whose price is the discounted line total, so Stripe
  // shows exactly what Sellbase computed (a per-unit price could not carry split cents).
  const items: FormValue[] = input.lines.map((line) => ({
    quantity: 1,
    price_data: {
      currency,
      unit_amount: line.total_amount,
      product_data: {
        name: line.quantity > 1 ? `${line.title} × ${line.quantity}` : line.title,
        ...(line.image_url ? { images: [line.image_url] } : {}),
      },
    },
  }));
  const linesTotal = input.lines.reduce((sum, l) => sum + l.total_amount, 0);
  const extra = input.amount_total - linesTotal - input.shipping_amount;
  if (extra < 0) {
    throw sellbaseError(
      'INTERNAL_ERROR',
      'Checkout lines exceed the total.',
      'Report this as a bug.',
      { extra },
    );
  }
  if (extra > 0) {
    // Tax added on top (exclusive mode). Inclusive tax is already inside the lines.
    items.push({
      quantity: 1,
      price_data: { currency, unit_amount: extra, product_data: { name: 'Impuestos / Tax' } },
    });
  }
  return items;
}

function paymentMethodFrom(obj: { payment_method_types?: string[] }): PaymentMethod {
  const type = obj.payment_method_types?.[0];
  return type === 'oxxo' ? 'oxxo' : type === 'customer_balance' ? 'spei' : 'card';
}

interface CheckoutSessionObject {
  id: string;
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  amount_total: number;
  currency: string;
  payment_intent: string | null;
  client_reference_id: string | null;
  metadata?: Record<string, string>;
  payment_method_types?: string[];
}

export function stripePayments(options: {
  secretKey: string;
  fetch?: typeof fetch;
  now?: () => Date;
}): PaymentsAdapter {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());

  async function call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: URLSearchParams,
    idempotencyKey?: string,
  ): Promise<T> {
    const res = await doFetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${options.secretKey}`,
        ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      ...(body ? { body } : {}),
    });
    const json = (await res.json()) as T & StripeError;
    if (!res.ok) {
      const message = json.error?.message ?? `Stripe returned ${res.status}`;
      throw sellbaseError(
        res.status === 401 ? 'UNAUTHORIZED' : 'VALIDATION_ERROR',
        `Stripe: ${message}`,
        res.status === 401
          ? 'The Stripe secret key is invalid. Reconnect with POST /integrations/stripe/connect.'
          : 'Check the Stripe dashboard logs for this request.',
        { stripe_code: json.error?.code, status: res.status },
      );
    }
    return json;
  }

  return {
    id: 'stripe',

    supportedMethods(country) {
      return country === 'MX' ? ['card', 'oxxo'] : ['card'];
    },

    async createCheckout(input) {
      const expiresAt = Math.max(input.expires_at.getTime(), now().getTime() + MIN_SESSION_MS);
      const metadata = {
        sellbase_checkout_session_id: input.checkout_session_id,
        sellbase_store_id: input.store_id,
      };
      const body = toStripeForm({
        mode: 'payment',
        customer_email: input.email,
        client_reference_id: input.checkout_session_id,
        success_url: input.success_url,
        cancel_url: input.cancel_url,
        expires_at: Math.floor(expiresAt / 1000),
        locale: input.locale?.startsWith('es') ? 'es' : 'auto',
        payment_method_types: ['card'],
        line_items: checkoutLineItems(input),
        ...(input.shipping_amount > 0
          ? {
              shipping_options: [
                {
                  shipping_rate_data: {
                    type: 'fixed_amount',
                    display_name: 'Envío',
                    fixed_amount: {
                      amount: input.shipping_amount,
                      currency: input.currency.toLowerCase(),
                    },
                  },
                },
              ],
            }
          : {}),
        metadata,
        payment_intent_data: { metadata },
      });
      const session = await call<{ id: string; url: string; amount_total: number }>(
        'POST',
        '/checkout/sessions',
        body,
        input.idempotency_key,
      );
      if (session.amount_total !== input.amount_total) {
        throw sellbaseError(
          'INTERNAL_ERROR',
          `Stripe computed ${session.amount_total} but Sellbase expected ${input.amount_total}.`,
          'Report this as a bug; the checkout was not started.',
        );
      }
      return { mode: 'redirect', provider_session_id: session.id, url: session.url };
    },

    async verifyWebhook(req, secret) {
      const payload = await req.text();
      await verifyStripeSignature(
        payload,
        req.headers.get('stripe-signature') ?? '',
        secret,
        Math.floor(now().getTime() / 1000),
      );
      const event = JSON.parse(payload) as { id: string; type: string; data: unknown };
      return { id: event.id, type: event.type, data: event.data };
    },

    mapEvent(evt: ProviderEvent): NormalizedPaymentEvent | null {
      const obj = (evt.data as { object?: CheckoutSessionObject }).object;
      if (!obj || !evt.type.startsWith('checkout.session.')) return null;
      const sessionId = obj.metadata?.sellbase_checkout_session_id ?? obj.client_reference_id;
      if (!sessionId) return null; // not a Sellbase checkout
      const paid = {
        type: 'checkout.paid' as const,
        provider_event_id: evt.id,
        checkout_session_id: sessionId,
        provider_payment_id: obj.payment_intent ?? obj.id,
        method: paymentMethodFrom(obj),
        amount: obj.amount_total,
        currency: obj.currency.toUpperCase(),
        raw: { stripe_checkout_session_id: obj.id, payment_status: obj.payment_status },
      };
      switch (evt.type) {
        case 'checkout.session.completed':
          return obj.payment_status === 'unpaid'
            ? {
                type: 'checkout.pending',
                provider_event_id: evt.id,
                checkout_session_id: sessionId,
                method: paymentMethodFrom(obj),
              }
            : paid;
        case 'checkout.session.async_payment_succeeded':
          return paid;
        case 'checkout.session.async_payment_failed':
          return {
            type: 'payment.failed',
            provider_event_id: evt.id,
            checkout_session_id: sessionId,
            reason: 'async payment failed',
          };
        case 'checkout.session.expired':
          return {
            type: 'checkout.expired',
            provider_event_id: evt.id,
            checkout_session_id: sessionId,
          };
        default:
          return null;
      }
    },

    async refund(input) {
      const refund = await call<{ id: string; status: string }>(
        'POST',
        '/refunds',
        toStripeForm({
          payment_intent: input.provider_payment_id,
          amount: input.amount,
          metadata: { reason: input.reason },
        }),
        input.idempotency_key,
      );
      return {
        provider_refund_id: refund.id,
        status:
          refund.status === 'succeeded'
            ? 'succeeded'
            : refund.status === 'failed'
              ? 'failed'
              : 'pending',
      };
    },

    async sandboxCharge(input) {
      if (!options.secretKey.startsWith('sk_test_') && !options.secretKey.startsWith('rk_test_')) {
        throw sellbaseError(
          'FORBIDDEN',
          'Test purchases only run with Stripe test keys.',
          'Connect a test key (sk_test_…) or run test_purchase in a staging project.',
        );
      }
      const intent = await call<{ id: string; status: string; amount: number; currency: string }>(
        'POST',
        '/payment_intents',
        toStripeForm({
          amount: input.amount,
          currency: input.currency.toLowerCase(),
          payment_method: 'pm_card_visa',
          confirm: true,
          automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
          description: 'Sellbase test purchase',
          metadata: input.metadata,
        }),
        input.idempotency_key,
      );
      if (intent.status !== 'succeeded') {
        throw sellbaseError(
          'VALIDATION_ERROR',
          `Stripe test payment ended as "${intent.status}".`,
          'Check the Stripe dashboard (test mode) for this PaymentIntent.',
          { payment_intent: intent.id },
        );
      }
      return {
        provider_payment_id: intent.id,
        method: 'card',
        amount: intent.amount,
        currency: intent.currency.toUpperCase(),
      };
    },

    async test() {
      const account = await call<{ id: string; country: string; charges_enabled: boolean }>(
        'GET',
        '/account',
      );
      const mode = options.secretKey.includes('_test_') ? 'test mode' : 'live mode';
      return {
        ok: true,
        message: `Connected to Stripe account ${account.id} (${account.country}, ${mode})${
          !account.charges_enabled && mode === 'live mode'
            ? '. Warning: live charges are not enabled yet; finish activation in the Stripe dashboard.'
            : ''
        }.`,
      };
    },
  };
}
