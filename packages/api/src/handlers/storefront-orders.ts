import { routes, sellbaseError } from '@sellbase/core';
import type { Hono } from 'hono';
import type { Sql, TransactionSql } from 'postgres';
import { sha256Hex } from '../auth.js';
import type { Deps } from '../deps.js';
import { notFound } from '../errors.js';
import { register, type AppOptions } from '../http.js';

type Db = Sql | TransactionSql;

/** b***@example.com: enough for the buyer to recognize it, not to harvest it. */
export function maskEmail(email: string) {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 1)}***@${domain}`;
}

/** What a buyer may see about their order: no internal notes, no payment ids, no links. */
export async function loadOrderSummary(sql: Db, storeId: string, orderId: string) {
  const [order] = await sql`
    select number, email::text as email, status, payment_status, fulfillment_status, currency::text as currency,
           subtotal_amount, discount_amount, shipping_amount, tax_amount, total_amount, amount_paid, placed_at
      from sellbase.orders where id = ${orderId} and store_id = ${storeId}`;
  if (!order) return null;
  const [items, shipments, bookings, grants] = await Promise.all([
    sql`
      select title, variant_title, quantity, total_amount, fulfillment_type
        from sellbase.order_items where order_id = ${orderId} order by created_at, id`,
    sql`
      select s.carrier, s.tracking_number, s.tracking_url, s.status, s.created_at
        from sellbase.shipments s join sellbase.fulfillments f on f.id = s.fulfillment_id
       where f.order_id = ${orderId} and f.status <> 'cancelled' order by s.created_at`,
    sql`
      select coalesce(p.title, 'Cita') as title, b.starts_at, b.ends_at, r.timezone, b.status,
             case when b.status = 'confirmed' then b.meeting_url end as meeting_url
        from sellbase.bookings b
        join sellbase.resources r on r.id = b.resource_id
        left join sellbase.products p on p.id = b.product_id
       where b.order_id = ${orderId} and b.status not in ('held', 'expired') order by b.starts_at`,
    sql<
      { n: number }[]
    >`select count(*)::int as n from sellbase.digital_grants where order_id = ${orderId}`,
  ]);
  return {
    ...order,
    email: maskEmail(String(order.email)),
    items,
    shipments,
    bookings,
    has_downloads: (grants[0]?.n ?? 0) > 0,
  } as never;
}

export function registerStorefrontOrders(app: Hono, deps: Deps, options: AppOptions) {
  const { sql } = deps;

  register(app, deps, options, routes.storefrontCollectionsList, async ({ storeId }) => {
    const rows = await sql`
      select c.slug, c.title, c.description, count(p.id)::int as product_count
        from sellbase.collections c
        join sellbase.collection_products cp on cp.collection_id = c.id
        join sellbase.products p on p.id = cp.product_id and p.status = 'active'
       where c.store_id = ${storeId}
       group by c.id order by c.position, c.title`;
    return { data: rows as never };
  });

  register(app, deps, options, routes.storefrontCollectionGet, async ({ storeId, params }) => {
    const [row] = await sql`
      select c.slug, c.title, c.description,
             (select count(*)::int from sellbase.collection_products cp
                join sellbase.products p on p.id = cp.product_id and p.status = 'active'
               where cp.collection_id = c.id) as product_count
        from sellbase.collections c where c.store_id = ${storeId} and c.slug = ${params.slug}`;
    if (!row)
      throw notFound(
        'Collection',
        params.slug,
        'List collections with GET /storefront/collections.',
      );
    return row as never;
  });

  register(app, deps, options, routes.orderLookup, async ({ storeId, body }) => {
    const [order] = await sql<{ id: string }[]>`
      select id from sellbase.orders
       where store_id = ${storeId} and number = ${body.number} and email = ${body.email}
         and status <> 'pending_payment'`;
    const summary = order ? await loadOrderSummary(sql, storeId, order.id) : null;
    if (!summary) {
      throw sellbaseError(
        'NOT_FOUND',
        'We could not find an order with that number and email.',
        'Check the order number in the confirmation email and use the same email address.',
      );
    }
    return summary;
  });

  register(app, deps, options, routes.downloadInfo, async ({ storeId, params }) => {
    const [grant] = await sql<
      {
        product_title: string;
        file_name: string;
        downloads_used: number;
        download_limit: number | null;
        expires_at: Date;
        expired: boolean;
      }[]
    >`
      select coalesce(p.title, a.file_name) as product_title, a.file_name, g.downloads_used, g.download_limit,
             g.expires_at, g.expires_at <= now() as expired
        from sellbase.digital_grants g
        join sellbase.digital_assets a on a.id = g.digital_asset_id
        left join sellbase.variants v on v.id = a.variant_id
        left join sellbase.products p on p.id = v.product_id
       where g.token_hash = ${await sha256Hex(params.grant_token)} and g.store_id = ${storeId}`;
    if (!grant) {
      throw sellbaseError(
        'NOT_FOUND',
        'This download link is not valid.',
        'Contact the store to get a new download link.',
      );
    }
    const { expired, ...info } = grant;
    return {
      ...info,
      expires_at: info.expires_at.toISOString(),
      status: expired
        ? ('expired' as const)
        : grant.download_limit !== null && grant.downloads_used >= grant.download_limit
          ? ('limit_reached' as const)
          : ('ready' as const),
      download_url: `${deps.publicApiUrl}/v1/storefront/downloads/${encodeURIComponent(params.grant_token)}`,
    };
  });
}
