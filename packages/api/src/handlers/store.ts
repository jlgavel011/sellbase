import { routes, sellbaseError, type DoctorResponse } from '@sellbase/core';
import type { Hono } from 'hono';
import { actorRef } from '../auth.js';
import type { Deps } from '../deps.js';
import { register, type AppOptions } from '../http.js';

/** Latest migration this API version expects (`sellbase.schema_version`). */
export const EXPECTED_SCHEMA_VERSION = '0006';

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
                ${tx.json({ provider, has_webhook_secret: Boolean(body.webhook_secret) } as never)})`;
      });

      const result = await testProvider(deps, storeId, provider);
      const [integration] = await sql`
      update sellbase.integrations
         set status = ${result.ok ? 'connected' : 'error'}, last_error = ${result.ok ? null : result.message},
             connected_at = ${result.ok ? sql`now()` : sql`connected_at`}
       where store_id = ${storeId} and provider = ${provider}
      returning provider, kind, status, config, connected_at, last_error`;
      return { integration, connect_url: null } as never;
    },
  );

  register(app, deps, options, routes.integrationTest, async ({ storeId, params }) => {
    assertProvider(params.provider);
    const result = await testProvider(deps, storeId, params.provider);
    await sql`
      update sellbase.integrations set status = ${result.ok ? 'connected' : 'error'},
             last_error = ${result.ok ? null : result.message}
       where store_id = ${storeId} and provider = ${params.provider}`;
    return result;
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
  if (stripe?.status === 'connected') add('payments', 'Payments', 'ok', 'Stripe connected.');
  else
    add(
      'payments',
      'Payments',
      'fail',
      stripe
        ? `Stripe error: ${stripe.last_error ?? 'unknown'}.`
        : 'No payment provider connected.',
      'Connect Stripe: POST /integrations/stripe/connect with your secret_key and webhook_secret.',
    );

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

  const [webhook] = await sql<{ n: number }[]>`
    select count(*)::int as n from sellbase.processed_webhooks where provider = 'stripe'`;
  if ((webhook?.n ?? 0) > 0)
    add('webhooks', 'Payment webhooks', 'ok', 'Stripe webhooks are arriving.');
  else
    add(
      'webhooks',
      'Payment webhooks',
      'warn',
      'No Stripe webhook received yet.',
      `Point a Stripe webhook to ${deps.publicApiUrl.replace(/sellbase-api.*$/, 'sellbase-webhooks/stripe')} and run test_purchase.`,
    );

  return { ok: checks.every((c) => c.status !== 'fail'), checks };
}
