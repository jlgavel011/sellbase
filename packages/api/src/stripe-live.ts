import { MIN_CHARGE, sellbaseError, type PaymentsAdapter } from '@sellbase/core';
import type { Deps } from './deps.js';

/**
 * Going live with Stripe (plan 2d): account status, automatic webhook endpoint and the
 * real-money verification. The integration config keeps what the owner needs to see;
 * secrets stay in Vault.
 */

export interface StripeConfig {
  mode?: 'test' | 'live';
  account?: {
    id: string;
    name: string | null;
    country: string;
    default_currency: string;
    charges_enabled: boolean;
    payouts_enabled: boolean;
    details_submitted: boolean;
    checked_at: string;
  };
  webhook?: { setup: 'auto' | 'manual'; endpoint_id?: string; url: string };
  last_webhook_at?: string;
  last_webhook_livemode?: boolean;
  live_check?: {
    id: string;
    status: 'pending' | 'paid' | 'refunded' | 'refund_failed';
    amount: number;
    currency: string;
    created_at: string;
    paid_at?: string;
    refunded_at?: string;
    provider_payment_id?: string;
    error?: string;
  };
}

/** Where Stripe must send events; null when the project has no public https URL (local). */
export function stripeWebhookUrl(deps: Deps): string | null {
  const url = deps.publicApiUrl.replace(/sellbase-api.*$/, 'sellbase-webhooks/stripe');
  const { protocol, hostname } = new URL(url);
  const local =
    ['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname) || hostname.endsWith('.local');
  return protocol === 'https:' && !local ? url : null;
}

export async function loadStripeConfig(deps: Deps, storeId: string): Promise<StripeConfig> {
  const [row] = await deps.sql<{ config: StripeConfig }[]>`
    select config from sellbase.integrations where store_id = ${storeId} and provider = 'stripe'`;
  return row?.config ?? {};
}

export async function patchStripeConfig(deps: Deps, storeId: string, patch: Partial<StripeConfig>) {
  await deps.sql`
    update sellbase.integrations set config = config || ${deps.sql.json(patch as never)}
     where store_id = ${storeId} and provider = 'stripe'`;
}

/** Reads the Stripe account and stores its status in the integration config. */
export async function refreshStripeAccount(deps: Deps, storeId: string, adapter: PaymentsAdapter) {
  if (!adapter.account) return null;
  const account = await adapter.account();
  const { mode, ...rest } = account;
  await patchStripeConfig(deps, storeId, {
    mode,
    account: { ...rest, checked_at: deps.now().toISOString() },
  });
  return account;
}

/**
 * Makes sure Stripe sends checkout events to this project. With a public URL the endpoint
 * is created (or re-created) in Stripe and its signing secret saved in Vault; locally the
 * owner forwards events with `stripe listen` and connects that secret.
 */
export async function setupStripeWebhook(
  deps: Deps,
  storeId: string,
  adapter: PaymentsAdapter,
  secrets: Record<string, string>,
) {
  const url = stripeWebhookUrl(deps);
  const local = deps.publicApiUrl.replace(/sellbase-api.*$/, 'sellbase-webhooks/stripe');
  // A secret sent by the owner (e.g. from `stripe listen`) means they manage the endpoint.
  if (!url || !adapter.ensureWebhook || secrets.webhook_secret) {
    await patchStripeConfig(deps, storeId, { webhook: { setup: 'manual', url: local } });
    return { setup: 'manual' as const, url: local };
  }
  const result = await adapter.ensureWebhook(url, { haveSecret: false });
  if (result.secret) {
    await deps.sql`select sellbase.set_integration_secret(${storeId}, 'stripe',
      ${JSON.stringify({ ...secrets, webhook_secret: result.secret })})`;
  }
  await patchStripeConfig(deps, storeId, {
    webhook: { setup: 'auto', endpoint_id: result.endpoint_id, url },
  });
  return { setup: 'auto' as const, url, created: result.created };
}

/** Starts a live check: a real minimum charge the owner pays and gets back. */
export async function startLiveCheck(deps: Deps, storeId: string, successUrl: string | undefined) {
  const adapter = await deps.payments(storeId);
  if (!adapter) {
    throw sellbaseError(
      'VALIDATION_ERROR',
      'Stripe is not connected.',
      'Connect it first: POST /integrations/stripe/connect.',
    );
  }
  if (adapter.mode?.() !== 'live') {
    throw sellbaseError(
      'VALIDATION_ERROR',
      'Stripe is in test mode: there is no real money to verify.',
      'Use test_purchase in test mode. Connect live keys (sk_live_…) with confirm: true to go live.',
    );
  }
  const secrets = await deps.secrets(storeId, 'stripe');
  if (!secrets?.webhook_secret) {
    throw sellbaseError(
      'VALIDATION_ERROR',
      'Stripe webhooks are not set up, so the payment could not be confirmed.',
      'Deploy with a public https URL and reconnect Stripe, or run `stripe listen --live --forward-to <webhooks URL>` and connect its whsec_ as webhook_secret.',
    );
  }
  const [store] = await deps.sql<
    { currency: string; email: string | null; settings: { site_url?: string } }[]
  >`select default_currency::text as currency, contact_email::text as email, settings from sellbase.stores where id = ${storeId}`;
  const currency = store?.currency ?? 'MXN';
  const amount = MIN_CHARGE[currency] ?? 100;
  const success = successUrl ?? store?.settings.site_url;
  if (!success) {
    throw sellbaseError(
      'VALIDATION_ERROR',
      'Where should the owner land after paying?',
      'Send success_url, or set settings.site_url on the store (PATCH /store).',
    );
  }
  const id = crypto.randomUUID();
  const expiresAt = new Date(deps.now().getTime() + 60 * 60_000);
  const checkout = await adapter.createCheckout({
    checkout_session_id: null,
    live_check_id: id,
    store_id: storeId,
    currency,
    amount_total: amount,
    email: store?.email ?? '',
    lines: [
      { title: 'Verificación de pagos Sellbase (se reembolsa)', quantity: 1, total_amount: amount },
    ],
    shipping_amount: 0,
    success_url: success,
    cancel_url: success,
    expires_at: expiresAt,
    idempotency_key: `live-check-${id}`,
  });
  if (checkout.mode !== 'redirect') throw new Error('live checks need a redirect checkout');
  await patchStripeConfig(deps, storeId, {
    live_check: { id, status: 'pending', amount, currency, created_at: deps.now().toISOString() },
  });
  return {
    live_check_id: id,
    url: checkout.url,
    amount,
    currency,
    expires_at: expiresAt.toISOString(),
  };
}

/** Webhook side of the live check: record the payment and refund it right away. */
export async function completeLiveCheck(
  deps: Deps,
  storeId: string,
  event: { live_check_id: string; provider_payment_id: string; amount: number; currency: string },
) {
  const config = await loadStripeConfig(deps, storeId);
  const check = config.live_check;
  if (!check || check.id !== event.live_check_id || check.status === 'refunded') return;
  const paid = {
    ...check,
    status: 'paid' as const,
    paid_at: deps.now().toISOString(),
    provider_payment_id: event.provider_payment_id,
  };
  await patchStripeConfig(deps, storeId, { live_check: paid });
  const adapter = await deps.payments(storeId);
  try {
    if (!adapter) throw new Error('Stripe is not connected.');
    const refund = await adapter.refund({
      provider_payment_id: event.provider_payment_id,
      amount: event.amount,
      reason: 'Sellbase live check',
      idempotency_key: `live-check-refund-${check.id}`,
    });
    if (refund.status === 'failed') throw new Error('Stripe reported the refund as failed.');
    await patchStripeConfig(deps, storeId, {
      live_check: { ...paid, status: 'refunded', refunded_at: deps.now().toISOString() },
    });
  } catch (error) {
    await patchStripeConfig(deps, storeId, {
      live_check: {
        ...paid,
        status: 'refund_failed',
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
  const { actor_type, actor_id } = { actor_type: 'webhook', actor_id: 'stripe' };
  await deps.sql`
    insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, diff)
    values (${storeId}, ${actor_type}, ${actor_id}, 'integration.live_check', 'integration',
            ${deps.sql.json({ live_check_id: check.id, amount: event.amount, currency: event.currency } as never)})`;
}
