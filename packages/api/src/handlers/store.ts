import { routes, sellbaseError, type DoctorResponse } from '@sellbase/core';
import type { Hono } from 'hono';
import { actorRef } from '../auth.js';
import type { Deps } from '../deps.js';
import { register, type AppOptions } from '../http.js';
import { contentTypeFor, decodeBase64, safeFileName } from './catalog.js';
import { renderOrderConfirmation, toLocale } from '@sellbase/emails';
import {
  loadStripeConfig,
  refreshStripeAccount,
  setupStripeWebhook,
  startLiveCheck,
  stripeWebhookUrl,
  type StripeConfig,
} from '../stripe-live.js';

/** Latest migration this API version expects (`sellbase.schema_version`). */
export const EXPECTED_SCHEMA_VERSION = '0009';

/** Providers that can be connected, with the kind of integration and how to test them. */
const PROVIDERS = {
  stripe: {
    kind: 'payments',
    keyPattern: /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/,
    keyHint: 'Use a Stripe secret key (sk_test_… or sk_live_…) from dashboard.stripe.com/apikeys.',
  },
  resend: {
    kind: 'notify',
    keyPattern: /^re_[A-Za-z0-9_]+$/,
    keyHint: 'Use a Resend API key (re_…) from resend.com/api-keys.',
  },
} as const;
type Provider = keyof typeof PROVIDERS;

const isProvider = (p: string): p is Provider => p in PROVIDERS;

function assertProvider(provider: string): asserts provider is Provider {
  if (!isProvider(provider)) {
    throw sellbaseError(
      'VALIDATION_ERROR',
      `Unknown provider "${provider}".`,
      `Supported providers: ${Object.keys(PROVIDERS).join(', ')}.`,
      { provider },
    );
  }
}

const STORE_COLUMNS = `id, name, slug, default_currency::text as default_currency, default_locale, timezone,
  country::text as country, contact_email::text as contact_email, logo_url, settings, platform_fee_bps,
  created_at, updated_at`;

async function testProvider(deps: Deps, storeId: string, provider: Provider) {
  const adapter = provider === 'stripe' ? await deps.payments(storeId) : await deps.notify(storeId);
  if (!adapter) return { ok: false, message: `${provider} is not connected.` };
  try {
    return await adapter.test();
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function registerStore(app: Hono, deps: Deps, options: AppOptions) {
  const { sql } = deps;

  register(app, deps, options, routes.storeGet, async ({ storeId }) => {
    const [store] =
      await sql`select ${sql.unsafe(STORE_COLUMNS)} from sellbase.stores where id = ${storeId}`;
    return store as never;
  });

  register(app, deps, options, routes.storeUpdate, async ({ storeId, actor, body }) => {
    const { settings, ...fields } = body;
    const [store] = await sql.begin(async (tx) => {
      if (Object.keys(fields).length > 0) {
        await tx`update sellbase.stores set ${tx(fields as Record<string, unknown>)} where id = ${storeId}`;
      }
      if (settings) {
        const [current] = await tx<{ settings: Record<string, unknown> }[]>`
          select settings from sellbase.stores where id = ${storeId} for update`;
        const merged = deepMerge(current?.settings ?? {}, settings);
        await tx`update sellbase.stores set settings = ${tx.json(merged as never)} where id = ${storeId}`;
      }
      return tx`select ${tx.unsafe(STORE_COLUMNS)} from sellbase.stores where id = ${storeId}`;
    });
    const { actor_type, actor_id } = actorRef(actor);
    await sql`
      insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, entity_id, diff)
      values (${storeId}, ${actor_type}, ${actor_id}, 'store.update', 'store', ${storeId}, ${sql.json(body as never)})`;
    return store as never;
  });

  register(app, deps, options, routes.storeLogoUpload, async ({ storeId, actor, body }) => {
    const type = contentTypeFor(body.file_name);
    if (!type.startsWith('image/')) {
      throw sellbaseError(
        'VALIDATION_ERROR',
        'The logo must be an image (PNG, JPG, WebP or SVG).',
        'Export the logo as PNG or SVG and upload it again.',
      );
    }
    const bytes = decodeBase64(body.content_base64, 2_000_000);
    const path = `${storeId}/brand/${crypto.randomUUID()}-${safeFileName(body.file_name)}`;
    await deps.storage.upload('sellbase-media', path, bytes, type);
    const url = deps.storage.publicUrl('sellbase-media', path);
    const [store] = await sql`
      update sellbase.stores set logo_url = ${url} where id = ${storeId}
      returning ${sql.unsafe(STORE_COLUMNS)}`;
    const { actor_type, actor_id } = actorRef(actor);
    await sql`
      insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, entity_id, diff)
      values (${storeId}, ${actor_type}, ${actor_id}, 'store.logo', 'store', ${storeId}, ${sql.json({ url } as never)})`;
    return store as never;
  });

  register(app, deps, options, routes.notificationsTest, async ({ storeId, body }) => {
    const [store] = await sql<
      {
        name: string;
        logo_url: string | null;
        contact_email: string | null;
        default_currency: string;
        default_locale: string;
        brand_color: string | null;
      }[]
    >`
      select name, logo_url, contact_email::text, default_currency::text, default_locale,
             settings ->> 'brand_color' as brand_color
        from sellbase.stores where id = ${storeId}`;
    if (!store) throw new Error('store not found');
    const notify = await deps.notify(storeId);
    const email = await renderOrderConfirmation({
      brand: {
        store_name: store.name,
        logo_url: store.logo_url,
        brand_color: store.brand_color,
        contact_email: store.contact_email,
      },
      locale: toLocale(store.default_locale),
      order: {
        number: 1001,
        currency: store.default_currency,
        subtotal_amount: 50000,
        discount_amount: 0,
        shipping_amount: 0,
        tax_amount: 6897,
        tax_mode: 'inclusive',
        total_amount: 50000,
        items: [
          { title: 'Producto de ejemplo', variant_title: null, quantity: 1, total_amount: 50000 },
        ],
        requires_shipping: false,
      },
      downloads: [],
    });
    try {
      await notify.send({
        to: body.to,
        ...email,
        subject: `[Prueba] ${email.subject}`,
        idempotency_key: `test-email-${crypto.randomUUID()}`,
      });
      const message =
        notify.id === 'log'
          ? 'Email is not connected yet: the message was only written to the function logs. Connect Resend to send real emails.'
          : `Sent to ${body.to}. Check the inbox (and spam).`;
      return { ok: notify.id !== 'log', message, provider: notify.id };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        provider: notify.id,
      };
    }
  });

  register(app, deps, options, routes.integrationsList, async ({ storeId }) => {
    const data = await sql`
      select provider, kind, status, config, connected_at, last_error
        from sellbase.integrations where store_id = ${storeId} order by provider`;
    return { data } as never;
  });

  register(
    app,
    deps,
    options,
    routes.integrationConnect,
    async ({ storeId, actor, params, body }) => {
      const { provider } = params;
      assertProvider(provider);
      const spec = PROVIDERS[provider];
      if (!body.secret_key || !spec.keyPattern.test(body.secret_key)) {
        throw sellbaseError(
          'VALIDATION_ERROR',
          `A valid ${provider} secret_key is required.`,
          spec.keyHint,
        );
      }
      const live = provider === 'stripe' && /^(sk|rk)_live_/.test(body.secret_key);
      if (live && body.confirm !== true) {
        throw sellbaseError(
          'VALIDATION_ERROR',
          'These are live Stripe keys: customers will pay real money.',
          'Confirm with the owner that the store is ready to sell, then send the same request with confirm: true.',
          { requires_confirmation: true },
        );
      }
      const secret: Record<string, string> = { secret_key: body.secret_key };
      if (body.webhook_secret) secret.webhook_secret = body.webhook_secret;

      await sql.begin(async (tx) => {
        await tx`
        insert into sellbase.integrations (store_id, provider, kind, status, config)
        values (${storeId}, ${provider}, ${spec.kind}, 'disabled', ${tx.json((body.config ?? {}) as never)})
        on conflict (store_id, provider) do update set config = sellbase.integrations.config || excluded.config`;
        await tx`select sellbase.set_integration_secret(${storeId}, ${provider}, ${JSON.stringify(secret)})`;
        const { actor_type, actor_id } = actorRef(actor);
        // Never log the secret itself.
        await tx`
        insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, diff)
        values (${storeId}, ${actor_type}, ${actor_id}, 'integration.connect', 'integration',
                ${tx.json({ provider, live, has_webhook_secret: Boolean(body.webhook_secret) } as never)})`;
      });

      let result = await testProvider(deps, storeId, provider);
      const nextSteps: string[] = [];
      if (provider === 'stripe' && result.ok) {
        const adapter = await deps.payments(storeId);
        try {
          if (adapter) {
            // A new key starts from a clean slate: no webhook seen, no live check yet.
            await sql`
              update sellbase.integrations
                 set config = config - 'last_webhook_at' - 'last_webhook_livemode' - 'live_check' - 'webhook'
               where store_id = ${storeId} and provider = 'stripe'`;
            const account = await refreshStripeAccount(deps, storeId, adapter);
            const hook = await setupStripeWebhook(deps, storeId, adapter, secret);
            if (hook.setup === 'manual' && !body.webhook_secret)
              nextSteps.push(
                `Forward Stripe events: stripe listen${live ? ' --live' : ''} --forward-to ${hook.url}, then connect again with its whsec_ as webhook_secret.`,
              );
            if (live && account && !account.charges_enabled)
              nextSteps.push(
                'Finish activating the Stripe account (dashboard.stripe.com) so it can take live charges.',
              );
            if (live)
              nextSteps.push(
                'Run the live check: POST /integrations/stripe/live-check (payments_live_check).',
              );
            else nextSteps.push('Run test_purchase to check the whole flow in test mode.');
          }
        } catch (error) {
          result = { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
      }
      const [integration] = await sql`
      update sellbase.integrations
         set status = ${result.ok ? 'connected' : 'error'}, last_error = ${result.ok ? null : result.message},
             connected_at = ${result.ok ? sql`now()` : sql`connected_at`}
       where store_id = ${storeId} and provider = ${provider}
      returning provider, kind, status, config, connected_at, last_error`;
      return { integration, connect_url: null, next_steps: nextSteps } as never;
    },
  );

  register(app, deps, options, routes.integrationTest, async ({ storeId, params }) => {
    assertProvider(params.provider);
    const result = await testProvider(deps, storeId, params.provider);
    if (params.provider === 'stripe' && result.ok) {
      const adapter = await deps.payments(storeId);
      if (adapter) await refreshStripeAccount(deps, storeId, adapter).catch(() => null);
    }
    await sql`
      update sellbase.integrations set status = ${result.ok ? 'connected' : 'error'},
             last_error = ${result.ok ? null : result.message}
       where store_id = ${storeId} and provider = ${params.provider}`;
    return result;
  });

  register(app, deps, options, routes.integrationLiveCheck, async ({ storeId, actor, body }) => {
    const check = await startLiveCheck(deps, storeId, body.success_url);
    const { actor_type, actor_id } = actorRef(actor);
    await sql`
      insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, diff)
      values (${storeId}, ${actor_type}, ${actor_id}, 'integration.live_check_start', 'integration',
              ${sql.json({ live_check_id: check.live_check_id, amount: check.amount } as never)})`;
    return check;
  });

  register(app, deps, options, routes.doctor, ({ storeId }) => runDoctor(deps, storeId));
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Merges nested objects so PATCH { tax: { rate_bps } } keeps the other tax fields. */
export function deepMerge(base: Json, patch: Json): Json {
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const prev = out[key];
    out[key] = isObject(prev) && isObject(value) ? deepMerge(prev, value) : value;
  }
  return out;
}

/** Setup checklist (SPEC §7 /doctor, §14.2). Each pending item says what to do next. */
export async function runDoctor(deps: Deps, storeId: string): Promise<DoctorResponse> {
  const { sql } = deps;
  const checks: DoctorResponse['checks'] = [];
  const add = (
    id: string,
    label: string,
    status: 'ok' | 'warn' | 'fail',
    message: string,
    hint: string | null = null,
  ) => checks.push({ id, label, status, message, hint });

  const [version] = await sql<
    { version: string }[]
  >`select max(version) as version from sellbase.schema_version`;
  if (version?.version === EXPECTED_SCHEMA_VERSION)
    add('schema', 'Database schema', 'ok', `Schema ${version.version}.`);
  else
    add(
      'schema',
      'Database schema',
      'fail',
      `Schema ${version?.version ?? 'missing'}, expected ${EXPECTED_SCHEMA_VERSION}.`,
      'Run `sellbase upgrade` to apply pending migrations.',
    );

  const noRls = await sql<{ relname: string }[]>`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'sellbase' and c.relkind = 'r' and not c.relrowsecurity`;
  if (noRls.length === 0) add('rls', 'Row level security', 'ok', 'RLS is on for every table.');
  else
    add(
      'rls',
      'Row level security',
      'fail',
      `RLS is off on: ${noRls.map((r) => r.relname).join(', ')}.`,
      'Someone disabled RLS by hand. Re-enable it with `alter table sellbase.<t> enable row level security`.',
    );

  const [store] = await sql<{ contact_email: string | null }[]>`
    select contact_email::text from sellbase.stores where id = ${storeId}`;
  if (store?.contact_email) add('store', 'Store details', 'ok', 'Contact email set.');
  else
    add(
      'store',
      'Store details',
      'warn',
      'No contact email.',
      'Set contact_email with PATCH /store so customers can reply to order emails.',
    );

  const integrations = await sql<{ provider: string; status: string; last_error: string | null }[]>`
    select provider, status, last_error from sellbase.integrations where store_id = ${storeId}`;
  const byProvider = new Map(integrations.map((i) => [i.provider, i]));
  const stripe = byProvider.get('stripe');
  const stripeConfig: StripeConfig = stripe ? await loadStripeConfig(deps, storeId) : {};
  const account = stripeConfig.account;
  if (stripe?.status !== 'connected')
    add(
      'payments',
      'Payments',
      'fail',
      stripe
        ? `Stripe error: ${stripe.last_error ?? 'unknown'}.`
        : 'No payment provider connected.',
      'Connect Stripe: POST /integrations/stripe/connect with your secret_key.',
    );
  else if (stripeConfig.mode === 'live' && account && !account.charges_enabled)
    add(
      'payments',
      'Payments',
      'fail',
      `Stripe live account ${account.name ?? account.id} cannot take charges yet.`,
      'Finish activating the account in dashboard.stripe.com (business details and bank account), then POST /integrations/stripe/test.',
    );
  else if (stripeConfig.mode === 'live')
    add(
      'payments',
      'Payments',
      'ok',
      `Stripe live: ${account?.name ?? account?.id ?? 'account'} (${account?.country ?? '?'})${account && !account.payouts_enabled ? ', payouts not enabled yet' : ''}.`,
    );
  else
    add(
      'payments',
      'Payments',
      'warn',
      'Stripe is in test mode: nobody can pay real money yet.',
      'When the store is ready, connect live keys (sk_live_…) with confirm: true. Guide: docs/guides/stripe-live.md.',
    );

  if (stripeConfig.mode === 'live') {
    const check = stripeConfig.live_check;
    if (check?.status === 'refunded')
      add(
        'live_check',
        'Live payment check',
        'ok',
        `A real ${check.currency} charge went through and was refunded.`,
      );
    else if (check?.status === 'refund_failed')
      add(
        'live_check',
        'Live payment check',
        'warn',
        `The check was paid but the refund failed: ${check.error ?? 'unknown error'}.`,
        'Refund it from the Stripe dashboard (Payments), then run the check again if needed.',
      );
    else
      add(
        'live_check',
        'Live payment check',
        'warn',
        check?.status === 'pending'
          ? 'A live check is waiting to be paid.'
          : 'No real charge has been verified yet.',
        'Run payments_live_check (POST /integrations/stripe/live-check) and pay the minimum amount; it is refunded automatically.',
      );
  }

  const resend = byProvider.get('resend');
  if (resend?.status === 'connected') add('email', 'Order emails', 'ok', 'Resend connected.');
  else
    add(
      'email',
      'Order emails',
      'warn',
      'No email provider: emails are only logged.',
      'Connect Resend: POST /integrations/resend/connect with your API key.',
    );

  const [products] = await sql<{ n: number }[]>`
    select count(*)::int as n from sellbase.products where store_id = ${storeId} and status = 'active'`;
  if ((products?.n ?? 0) > 0) add('catalog', 'Catalog', 'ok', `${products?.n} active products.`);
  else
    add(
      'catalog',
      'Catalog',
      'warn',
      'No active products.',
      'Create one with product_upsert (status "active").',
    );

  const [jobs] = await sql<{ configured: boolean }[]>`
    select exists (select 1 from vault.secrets where name = 'sellbase_jobs_url') as configured`;
  if (jobs?.configured) add('jobs', 'Background jobs', 'ok', 'Scheduled every minute.');
  else
    add(
      'jobs',
      'Background jobs',
      'fail',
      'The jobs function is not scheduled: paid orders would not get files or emails.',
      'Run `npx sellbase init` again, or `select sellbase.configure_jobs(<jobs function URL>, <service role key>)`.',
    );

  const hook = stripeConfig.webhook;
  const webhooksUrl = deps.publicApiUrl.replace(/sellbase-api.*$/, 'sellbase-webhooks/stripe');
  const seen =
    Boolean(stripeConfig.last_webhook_at) &&
    (stripeConfig.last_webhook_livemode === undefined ||
      stripeConfig.last_webhook_livemode === (stripeConfig.mode === 'live'));
  if (seen)
    add(
      'webhooks',
      'Payment webhooks',
      'ok',
      `Stripe webhooks are arriving (last ${stripeConfig.last_webhook_at}).`,
    );
  else if (stripe?.status === 'connected')
    add(
      'webhooks',
      'Payment webhooks',
      'warn',
      hook?.setup === 'auto'
        ? `Stripe webhook ${hook.endpoint_id ?? ''} is set up; no event received yet.`
        : 'No Stripe webhook received yet in this mode.',
      hook?.setup === 'auto'
        ? stripeConfig.mode === 'live'
          ? 'Run payments_live_check to see one arrive.'
          : 'Run test_purchase or a real checkout in test mode.'
        : `Locally: stripe listen${stripeConfig.mode === 'live' ? ' --live' : ''} --forward-to ${webhooksUrl}, and connect Stripe again with its whsec_ as webhook_secret. Deployed: reconnect Stripe and the endpoint is created for you.`,
    );

  // The private-network escape hatch belongs to the local stack only.
  if (deps.allowPrivateWebhooks && stripeWebhookUrl(deps) !== null)
    add(
      'webhook_guard',
      'Webhook network guard',
      'fail',
      'SELLBASE_WEBHOOKS_ALLOW_PRIVATE is on in a deployed project: webhooks could reach your private network.',
      'Remove it: npx supabase secrets unset SELLBASE_WEBHOOKS_ALLOW_PRIVATE.',
    );

  return { ok: checks.every((c) => c.status !== 'fail'), checks };
}
