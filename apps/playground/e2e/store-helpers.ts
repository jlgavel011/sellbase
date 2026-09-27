import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Values from the repo .env written by scripts/seed-demo.mjs (demo token, Stripe test). */
function repoEnv(): Record<string, string> {
  const path = join(import.meta.dirname, '../../../.env');
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .map((l) => /^([A-Z_]+)=(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => Boolean(m))
      .map((m) => [m[1] ?? '', m[2] ?? '']),
  );
}

const env = { ...repoEnv(), ...process.env } as Record<string, string | undefined>;
export const DEMO_TOKEN = env.SELLBASE_DEMO_TOKEN ?? '';
export const WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET ?? '';
/** seed-demo connects Stripe only when test keys exist (local .env or CI secrets). */
export const STRIPE_CONNECTED = Boolean(env.STRIPE_SECRET_KEY);
const base = (env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(/\/+$/, '');
export const API = `${base}/functions/v1/sellbase-api/v1`;
const WEBHOOKS = `${base}/functions/v1/sellbase-webhooks/stripe`;

/** Calls the Sellbase API as the demo agent (or anonymously for storefront routes). */
export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  auth = true,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: `Bearer ${DEMO_TOKEN}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json()) as T;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

/**
 * Delivers a Stripe "checkout.session.completed" webhook for a Sellbase checkout, signed
 * like Stripe does, as if the buyer had paid on Stripe's page.
 */
export async function payWithWebhook(checkoutSessionId: string, amount: number) {
  const event = {
    id: `evt_e2e_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    type: 'checkout.session.completed',
    livemode: false,
    data: {
      object: {
        id: `cs_e2e_${Date.now()}`,
        payment_status: 'paid',
        amount_total: amount,
        currency: 'mxn',
        payment_intent: `pi_e2e_${Date.now()}`,
        client_reference_id: checkoutSessionId,
        metadata: { sellbase_checkout_session_id: checkoutSessionId },
        payment_method_types: ['card'],
      },
    },
  };
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');
  const res = await fetch(WEBHOOKS, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${v1}` },
    body: payload,
  });
  if (!res.ok) throw new Error(`webhook failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Starts a real checkout (Stripe test session) for one variant, as the storefront would. */
export async function startCheckout(variantId: string, email: string) {
  const cart = await api<{ token: string }>('POST', '/storefront/carts', {}, false);
  const added = await api<{ totals: { total_amount: number } }>(
    'POST',
    `/storefront/carts/${cart.token}/items`,
    { variant_id: variantId, quantity: 1 },
    false,
  );
  const rates = await api<{ rates: { id: string; amount: number }[] }>(
    'POST',
    `/storefront/carts/${cart.token}/shipping-rates`,
    { address: { line1: 'Av. Reforma 1', city: 'CDMX', postal_code: '06600', country: 'MX' } },
    false,
  );
  const checkout = await api<{ checkout_session_id: string }>(
    'POST',
    '/storefront/checkout',
    {
      cart_token: cart.token,
      email,
      shipping_rate_id: rates.rates[0]?.id,
      shipping_address: {
        line1: 'Av. Reforma 1',
        city: 'CDMX',
        postal_code: '06600',
        country: 'MX',
      },
      success_url: 'http://localhost:3100/gracias',
      cancel_url: 'http://localhost:3100/carrito',
    },
    false,
  );
  const status = await api<{ status: string }>(
    'GET',
    `/storefront/checkout/${checkout.checkout_session_id}`,
    undefined,
    false,
  );
  // What Stripe would charge: the cart total plus the chosen shipping.
  const amount = added.totals.total_amount + (rates.rates[0]?.amount ?? 0);
  return { id: checkout.checkout_session_id, status: status.status, amount };
}
