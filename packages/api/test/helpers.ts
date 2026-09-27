import { logNotify, manualShipping } from '@sellbase/adapters';
import {
  DEFAULT_AGENT_SCOPES,
  type ApiScope,
  type NormalizedPaymentEvent,
  type NotifyMessage,
  type PaymentsAdapter,
} from '@sellbase/core';
import {
  createApiApp,
  createApiToken,
  createSql,
  createWebhooksApp,
  type Deps,
} from '../src/index.js';

export const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const sql = createSql(DB_URL, { max: 4 });

/** Fake Stripe-like provider: webhooks are JSON signed with a shared header. */
export function fakePayments() {
  const created: {
    checkout_session_id: string | null;
    order_id?: string;
    amount_total: number;
    lines: { title: string; total_amount: number }[];
  }[] = [];
  const refunds: { provider_payment_id: string; amount: number; idempotency_key: string }[] = [];
  const adapter: PaymentsAdapter = {
    id: 'stripe',
    supportedMethods: () => ['card'],
    async createCheckout(input) {
      created.push({
        checkout_session_id: input.checkout_session_id,
        ...(input.order_id ? { order_id: input.order_id } : {}),
        amount_total: input.amount_total,
        lines: input.lines,
      });
      return {
        mode: 'redirect',
        provider_session_id: `cs_test_${input.checkout_session_id ?? input.order_id}`,
        url: `https://pay.test/${input.checkout_session_id ?? input.order_id}`,
      };
    },
    async verifyWebhook(req, secret) {
      if (req.headers.get('x-test-signature') !== secret) throw new Error('bad signature');
      return (await req.json()) as { id: string; type: string; data: unknown };
    },
    mapEvent(evt) {
      return (evt.data ?? null) as NormalizedPaymentEvent | null;
    },
    async sandboxCharge(input) {
      return {
        provider_payment_id: `pi_test_${crypto.randomUUID()}`,
        method: 'card',
        amount: input.amount,
        currency: input.currency,
      };
    },
    async refund(input) {
      refunds.push({
        provider_payment_id: input.provider_payment_id,
        amount: input.amount,
        idempotency_key: input.idempotency_key,
      });
      return { provider_refund_id: `re_${refunds.length}`, status: 'succeeded' };
    },
    async test() {
      return { ok: true, message: 'fake ok' };
    },
  };
  return { adapter, created, refunds };
}

export interface TestStore {
  storeId: string;
  deps: Deps;
  api: ReturnType<typeof createApiApp>;
  webhooks: ReturnType<typeof createWebhooksApp>;
  emails: NotifyMessage[];
  uploads: { bucket: string; path: string; size: number }[];
  payments: ReturnType<typeof fakePayments>;
  invites: { email: string; redirectTo: string | null }[];
  /** Outbound webhook requests, and status codes to answer the next ones with. */
  hooks: { url: string; headers: Record<string, string>; body: string }[];
  hookResponses: number[];
  token: (scopes?: readonly ApiScope[]) => Promise<string>;
  staff: (role: 'owner' | 'admin' | 'staff') => Promise<string>;
  request: (
    method: string,
    path: string,
    init?: { body?: unknown; token?: string; headers?: Record<string, string> },
  ) => Promise<{ status: number; body: any }>;
}

let counter = 0;

export async function createTestStore(
  options: { shipping?: Record<string, unknown>; paymentsConnected?: boolean } = {},
): Promise<TestStore> {
  counter += 1;
  const slug = `test-${Date.now().toString(36)}-${counter}`;
  const [store] = await sql<{ id: string }[]>`
    insert into sellbase.stores (name, slug, default_currency, country, contact_email, settings)
    values ('Test Store', ${slug}, 'MXN', 'MX', 'owner@test.dev',
            ${sql.json({ tax: { mode: 'inclusive', rate_bps: 1600 }, shipping: options.shipping ?? { flat_rate_amount: 9900 } } as never)})
    returning id`;
  if (!store) throw new Error('store insert returned no row');
  const storeId = store.id;
  const emails: NotifyMessage[] = [];
  const uploads: { bucket: string; path: string; size: number }[] = [];
  const payments = fakePayments();
  const users = new Map<string, string>();
  const invites: { email: string; redirectTo: string | null }[] = [];
  const hooks: { url: string; headers: Record<string, string>; body: string }[] = [];
  const hookResponses: number[] = [];
  const webhookFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    hooks.push({ url: String(input), headers, body: String(init?.body ?? '') });
    return new Response('ok', { status: hookResponses.shift() ?? 200 });
  };
  const secrets = { stripe: { secret_key: 'sk_test_fake', webhook_secret: 'whsec_test' } };

  const deps: Deps = {
    sql,
    storeId: async () => storeId,
    verifyUserJwt: async (jwt) => users.get(jwt) ?? null,
    inviteUser: async (email, redirectTo) => {
      const id = crypto.randomUUID();
      await sql`insert into auth.users (id, email, aud, role, invited_at) values (${id}, ${email}, 'authenticated', 'authenticated', now())`;
      invites.push({ email, redirectTo: redirectTo ?? null });
      return id;
    },
    fetch: (input, init) => webhookFetch(input, init),
    secrets: async (_id, provider) =>
      provider === 'stripe' && options.paymentsConnected !== false ? secrets.stripe : null,
    payments: async () => (options.paymentsConnected === false ? null : payments.adapter),
    shipping: async () => manualShipping(options.shipping ?? { flat_rate_amount: 9900 }),
    notify: async () => logNotify((m) => emails.push(m)),
    storage: {
      signedUrl: async (bucket, path, ttl) => `https://storage.test/${bucket}/${path}?ttl=${ttl}`,
      upload: async (bucket, path, bytes) => {
        uploads.push({ bucket, path, size: bytes.byteLength });
      },
      publicUrl: (bucket, path) => `https://storage.test/public/${bucket}/${path}`,
    },
    now: () => new Date(),
    publicApiUrl: 'https://project.test/functions/v1/sellbase-api',
    version: '0.1.0-test',
  };
  const api = createApiApp(deps, { validateResponses: true, rateLimitPerMinute: 10_000 });
  const webhooks = createWebhooksApp(deps);

  return {
    storeId,
    deps,
    api,
    webhooks,
    emails,
    uploads,
    payments,
    invites,
    hooks,
    hookResponses,
    token: async (scopes = DEFAULT_AGENT_SCOPES) =>
      (await createApiToken(deps, { storeId, name: 'test', scopes })).token,
    staff: async (role) => {
      const userId = crypto.randomUUID();
      await sql`insert into auth.users (id, email, aud, role) values (${userId}, ${`${userId}@test.dev`}, 'authenticated', 'authenticated')`;
      await sql`insert into sellbase.staff_members (store_id, user_id, role) values (${storeId}, ${userId}, ${role})`;
      const jwt = `jwt-${userId}`;
      users.set(jwt, userId);
      return jwt;
    },
    request: async (method, path, init = {}) => {
      const headers: Record<string, string> = { ...(init.headers ?? {}) };
      if (init.body !== undefined) headers['content-type'] = 'application/json';
      if (init.token) headers.authorization = `Bearer ${init.token}`;
      const res = await api.request(`/sellbase-api/v1${path}`, {
        method,
        headers,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        redirect: 'manual',
      });
      const text = await res.text();
      return {
        status: res.status,
        body: text ? (safeJson(text) ?? text) : null,
        headers: res.headers,
      } as never;
    },
  };
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Sends a signed fake webhook. */
export async function sendWebhook(
  store: TestStore,
  event: { id: string; data: unknown },
  signature = 'whsec_test',
) {
  const res = await store.webhooks.request('/sellbase-webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-signature': signature },
    body: JSON.stringify({ id: event.id, type: 'test', data: event.data }),
  });
  return { status: res.status, body: (await res.json()) as any };
}
