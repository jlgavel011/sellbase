import { BRAND, WEBHOOK_EVENTS } from '@sellbase/core';
import type { Sql, TransactionSql } from 'postgres';
import type { Deps } from './deps.js';
import { assertWebhookDestination, defaultResolver } from './net-guard.js';
import { loadAdminProduct } from './handlers/catalog.js';
import { loadOrderDetail } from './handlers/orders.js';
import { loadBooking } from './services.js';

type Db = Sql | TransactionSql;

/** Minutes to wait after each failed attempt; after the last one the delivery fails. */
export const WEBHOOK_BACKOFF_MIN = [1, 5, 30, 120, 720] as const;
const TIMEOUT_MS = 10_000;

export const SIGNATURE_HEADER = `${BRAND.name}-Signature`;

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`, like Stripe. */
export async function signWebhook(secret: string, body: string, at: Date) {
  const t = Math.floor(at.getTime() / 1000);
  return `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}`;
}

/** Verifies a signature header (for receivers and tests). Tolerance in seconds. */
export async function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string,
  now = new Date(),
  toleranceSec = 300,
) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs(now.getTime() / 1000 - t) > toleranceSec) return false;
  return (await hmacHex(secret, `${t}.${body}`)) === parts.v1;
}

interface OutboxEventRow {
  id: string;
  type: string;
  store_id: string;
  entity: string;
  entity_id: string | null;
  payload: object;
  created_at: Date;
}

/** The object the event is about, as the API would return it. */
async function eventData(db: Db, event: OutboxEventRow) {
  const base = { entity: event.entity, entity_id: event.entity_id, details: event.payload };
  if (!event.entity_id) return base;
  try {
    if (event.entity === 'order')
      return { ...base, order: await loadOrderDetail(db, event.store_id, event.entity_id) };
    if (event.entity === 'product')
      return { ...base, product: await loadAdminProduct(db, event.store_id, event.entity_id) };
    if (event.entity === 'booking')
      return { ...base, booking: await loadBooking(db, event.store_id, event.entity_id) };
  } catch {
    // The record may be gone (e.g. deleted); the event still goes out.
  }
  return base;
}

/**
 * One delivery per enabled endpoint subscribed to the event, never for events older than
 * the endpoint. Runs inside the job's transaction.
 */
export async function enqueueWebhooks(tx: TransactionSql, event: OutboxEventRow) {
  if (!(WEBHOOK_EVENTS as readonly string[]).includes(event.type)) return 0;
  const endpoints = await tx<{ id: string }[]>`
    select id from sellbase.webhook_endpoints
     where store_id = ${event.store_id} and enabled and created_at <= ${event.created_at}
       and (cardinality(events) = 0 or ${event.type} = any(events))`;
  if (endpoints.length === 0) return 0;
  const payload = {
    id: event.id,
    type: event.type,
    created_at: event.created_at.toISOString(),
    store_id: event.store_id,
    data: JSON.parse(JSON.stringify(await eventData(tx, event))) as object,
  };
  for (const endpoint of endpoints) {
    await tx`
      insert into sellbase.webhook_deliveries (store_id, endpoint_id, event_id, event_type, payload)
      values (${event.store_id}, ${endpoint.id}, ${event.id}, ${event.type}, ${tx.json(payload as never)})
      on conflict (endpoint_id, event_id) do nothing`;
  }
  return endpoints.length;
}

interface DeliveryRow {
  id: string;
  endpoint_id: string;
  event_type: string;
  payload: object;
  attempts: number;
  url: string;
  secret: string | null;
}

/**
 * Sends due deliveries. Each one is leased first (next_attempt_at pushed ahead) so two
 * runs never send it at the same time. 2xx = succeeded; anything else retries with
 * backoff and fails after the last attempt.
 */
export async function deliverWebhooks(
  deps: Deps,
  options: { storeId?: string; deliveryId?: string; limit?: number } = {},
) {
  const { sql } = deps;
  const doFetch = deps.fetch ?? fetch;
  const due = await sql<DeliveryRow[]>`
    with claimed as (
      select d.id from sellbase.webhook_deliveries d
       where d.status = 'pending'
         ${options.deliveryId ? sql`and d.id = ${options.deliveryId}` : sql`and d.next_attempt_at <= now()`}
         ${options.storeId ? sql`and d.store_id = ${options.storeId}` : sql``}
       order by d.next_attempt_at limit ${options.limit ?? 50}
       for update skip locked
    )
    update sellbase.webhook_deliveries d set next_attempt_at = now() + interval '2 minutes'
      from claimed, sellbase.webhook_endpoints e
     where d.id = claimed.id and e.id = d.endpoint_id
    returning d.id, d.endpoint_id, d.event_type, d.payload, d.attempts, e.url,
              sellbase.get_webhook_secret(e.id) as secret`;

  const summary = { sent: 0, failed: 0 };
  for (const d of due) {
    const body = JSON.stringify(d.payload);
    let status: number | null = null;
    let error: string | null = null;
    try {
      if (!d.secret) throw new Error('The endpoint has no signing secret.');
      // Checked again at send time: DNS can change after the endpoint was saved.
      await assertWebhookDestination(d.url, {
        allowPrivate: deps.allowPrivateWebhooks === true,
        resolve: deps.resolveHost ?? defaultResolver,
      });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await doFetch(d.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': `${BRAND.name}-Webhooks/1`,
            [SIGNATURE_HEADER]: await signWebhook(d.secret, body, deps.now()),
            [`${BRAND.name}-Event`]: d.event_type,
            [`${BRAND.name}-Delivery`]: d.id,
          },
          body,
          signal: controller.signal,
          // A redirect could point anywhere, including the private network: never follow.
          redirect: 'manual',
        });
        status = res.status;
        if (res.status >= 300 && res.status < 400)
          error = `HTTP ${res.status}: redirects are not followed; use the final URL.`;
        else if (!res.ok) error = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      error =
        e instanceof Error
          ? e.name === 'AbortError'
            ? 'Timed out after 10 s'
            : e.message
          : String(e);
    }
    const attempts = d.attempts + 1;
    if (!error) {
      summary.sent += 1;
      await sql`
        update sellbase.webhook_deliveries
           set status = 'succeeded', attempts = ${attempts}, last_status_code = ${status}, last_error = null,
               delivered_at = now()
         where id = ${d.id}`;
    } else {
      summary.failed += 1;
      const wait = WEBHOOK_BACKOFF_MIN[attempts - 1];
      await sql`
        update sellbase.webhook_deliveries
           set attempts = ${attempts}, last_status_code = ${status}, last_error = ${error},
               status = ${wait === undefined ? 'failed' : 'pending'},
               next_attempt_at = now() + ${`${wait ?? 0} minutes`}::interval
         where id = ${d.id}`;
    }
  }
  return summary;
}
