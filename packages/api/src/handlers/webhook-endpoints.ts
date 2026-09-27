import { routes, sellbaseError, WEBHOOK_EVENTS } from '@sellbase/core';
import type { Hono } from 'hono';
import type { Sql, TransactionSql } from 'postgres';
import { actorRef, randomToken, type Actor } from '../auth.js';
import type { Deps } from '../deps.js';
import { notFound } from '../errors.js';
import { register, type AppOptions } from '../http.js';
import { assertWebhookDestination, defaultResolver } from '../net-guard.js';
import { deliverWebhooks } from '../webhooks-out.js';

type Db = Sql | TransactionSql;

const ENDPOINT_SELECT = `
  e.id, e.url, e.description, e.events, e.enabled, e.secret_prefix, e.created_at,
  jsonb_build_object(
    'pending', (select count(*)::int from sellbase.webhook_deliveries d where d.endpoint_id = e.id and d.status = 'pending'),
    'failed', (select count(*)::int from sellbase.webhook_deliveries d where d.endpoint_id = e.id and d.status = 'failed'),
    'last_delivery_at', (select max(d.created_at) from sellbase.webhook_deliveries d where d.endpoint_id = e.id),
    'last_status', (select d.status from sellbase.webhook_deliveries d where d.endpoint_id = e.id
                     order by d.created_at desc limit 1)
  ) as stats`;

const DELIVERY_SELECT = `
  id, event_type, status, attempts, last_status_code, last_error, next_attempt_at, delivered_at, created_at`;

async function loadEndpoint(db: Db, storeId: string, id: string) {
  const [row] = await db`
    select ${db.unsafe(ENDPOINT_SELECT)} from sellbase.webhook_endpoints e where e.id = ${id} and e.store_id = ${storeId}`;
  if (!row) throw notFound('Webhook endpoint', id, 'List endpoints with GET /webhooks.');
  return JSON.parse(JSON.stringify(row)) as never;
}

async function audit(
  db: Db,
  storeId: string,
  actor: Actor | null,
  action: string,
  id: string,
  diff: object,
) {
  const { actor_type, actor_id } = actorRef(actor);
  await db`
    insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, entity_id, diff)
    values (${storeId}, ${actor_type}, ${actor_id}, ${action}, 'webhook_endpoint', ${id}, ${db.json(diff as never)})`;
}

/**
 * An agent (API token) must confirm explicitly before data starts flowing to a URL: the
 * owner should see where customer and order data will go. Staff confirm in the admin.
 */
function assertConfirmed(actor: Actor | null, confirm: boolean | undefined, url: string | null) {
  if (actor?.type !== 'token' || confirm === true) return;
  throw sellbaseError(
    'VALIDATION_ERROR',
    url
      ? `This webhook will send customer and order data to ${url}.`
      : 'This change affects where customer and order data is sent.',
    'Show the owner the URL and events, and repeat the request with confirm: true once they approve.',
    { requires_confirmation: true },
  );
}

export function registerWebhookEndpoints(app: Hono, deps: Deps, options: AppOptions) {
  const { sql } = deps;
  const checkUrl = (url: string) =>
    assertWebhookDestination(url, {
      allowPrivate: deps.allowPrivateWebhooks === true,
      resolve: deps.resolveHost ?? defaultResolver,
    });

  register(app, deps, options, routes.webhooksList, async ({ storeId }) => {
    const rows = await sql`
      select ${sql.unsafe(ENDPOINT_SELECT)} from sellbase.webhook_endpoints e
       where e.store_id = ${storeId} order by e.created_at`;
    return { data: JSON.parse(JSON.stringify(rows)) as never, events: [...WEBHOOK_EVENTS] };
  });

  register(app, deps, options, routes.webhookCreate, async ({ storeId, actor, body }) => {
    assertConfirmed(actor, body.confirm, body.url);
    await checkUrl(body.url);
    const secret = `whsec_${randomToken(24)}`;
    const id = await sql.begin(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into sellbase.webhook_endpoints (store_id, url, events, description, created_by)
        values (${storeId}, ${body.url}, ${tx.array([...new Set(body.events)])}, ${body.description},
                ${actorRef(actor).actor_id})
        returning id`;
      if (!row) throw new Error('webhook insert returned no row');
      await tx`select sellbase.set_webhook_secret(${row.id}, ${secret})`;
      await audit(tx, storeId, actor, 'webhook.create', row.id, {
        url: body.url,
        events: body.events,
      });
      return row.id;
    });
    const view = (await loadEndpoint(sql, storeId, id)) as object;
    return { ...view, secret } as never;
  });

  register(app, deps, options, routes.webhookUpdate, async ({ storeId, actor, params, body }) => {
    assertConfirmed(actor, body.confirm, body.url ?? null);
    if (body.url) await checkUrl(body.url);
    const patch = {
      ...(body.url !== undefined ? { url: body.url } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    };
    await sql.begin(async (tx) => {
      const values = {
        ...patch,
        ...(body.events ? { events: [...new Set(body.events)] } : {}),
      };
      const [row] = Object.keys(values).length
        ? await tx`
            update sellbase.webhook_endpoints set ${tx(values)}
             where id = ${params.id} and store_id = ${storeId} returning id`
        : await tx`select id from sellbase.webhook_endpoints where id = ${params.id} and store_id = ${storeId}`;
      if (!row) throw notFound('Webhook endpoint', params.id, 'List endpoints with GET /webhooks.');
      await audit(tx, storeId, actor, 'webhook.update', params.id, body);
    });
    return loadEndpoint(sql, storeId, params.id);
  });

  register(app, deps, options, routes.webhookDelete, async ({ storeId, actor, params }) => {
    const [row] = await sql`
      delete from sellbase.webhook_endpoints where id = ${params.id} and store_id = ${storeId} returning url`;
    if (!row) throw notFound('Webhook endpoint', params.id, 'List endpoints with GET /webhooks.');
    await audit(sql, storeId, actor, 'webhook.delete', params.id, { url: row.url });
    return { id: params.id, deleted: true as const };
  });

  register(app, deps, options, routes.webhookTest, async ({ storeId, params }) => {
    await loadEndpoint(sql, storeId, params.id);
    const [delivery] = await sql<{ id: string }[]>`
      insert into sellbase.webhook_deliveries (store_id, endpoint_id, event_type, payload)
      values (${storeId}, ${params.id}, 'webhook.test',
              ${sql.json({ id: crypto.randomUUID(), type: 'webhook.test', created_at: deps.now().toISOString(), store_id: storeId, data: { message: 'Test event from the admin.' } } as never)})
      returning id`;
    if (!delivery) throw new Error('delivery insert returned no row');
    await deliverWebhooks(deps, { deliveryId: delivery.id });
    const [row] =
      await sql`select ${sql.unsafe(DELIVERY_SELECT)} from sellbase.webhook_deliveries where id = ${delivery.id}`;
    return row as never;
  });

  register(app, deps, options, routes.webhookDeliveries, async ({ storeId, params }) => {
    await loadEndpoint(sql, storeId, params.id);
    const rows = await sql`
      select ${sql.unsafe(DELIVERY_SELECT)} from sellbase.webhook_deliveries
       where endpoint_id = ${params.id} order by created_at desc limit 50`;
    return { data: rows as never };
  });
}
