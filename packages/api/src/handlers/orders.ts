import { routes } from '@sellbase/core';
import type { Hono } from 'hono';
import type { Sql, TransactionSql } from 'postgres';
import type { Deps } from '../deps.js';
import { notFound } from '../errors.js';
import { register, type AppOptions } from '../http.js';
import { decodeCursor, encodeCursor } from '../pagination.js';

type Db = Sql | TransactionSql;

const ORDER_COLUMNS = `id, number, channel, customer_id, email::text as email, phone, currency::text as currency,
  subtotal_amount, discount_amount, shipping_amount, tax_amount, total_amount, amount_paid, amount_refunded,
  status, payment_status, fulfillment_status, shipping_address, billing_address, notes, placed_at,
  cancelled_at, cancel_reason, metadata, created_at, updated_at`;

/** Full order for admin/agent views: snapshot items, payments, deliveries, refunds, timeline. */
export async function loadOrderDetail(sql: Db, storeId: string, id: string) {
  const [order] = await sql`
    select ${sql.unsafe(ORDER_COLUMNS)} from sellbase.orders where id = ${id} and store_id = ${storeId}`;
  if (!order) throw notFound('Order', id, 'Search orders with GET /orders.');
  const items = await sql`
    select id, order_id, variant_id, product_type, title, variant_title, sku, unit_price_amount, quantity,
           discount_amount, total_amount, fulfillment_type, fulfilled_quantity, metadata
      from sellbase.order_items where order_id = ${id} order by created_at, id`;
  const payments = await sql`
    select id, order_id, provider, provider_payment_id, method, kind, amount, currency::text as currency, status, created_at
      from sellbase.payments where order_id = ${id} order by created_at`;
  const fulfillments = await sql`
    select f.id, f.type, f.status, f.items, f.created_at,
           (select jsonb_build_object('carrier', s.carrier, 'tracking_number', s.tracking_number,
                                      'tracking_url', s.tracking_url, 'status', s.status)
              from sellbase.shipments s where s.fulfillment_id = f.id limit 1) as shipment
      from sellbase.fulfillments f where f.order_id = ${id} order by f.created_at`;
  const refunds = await sql`
    select r.id, r.amount, r.reason, r.status, r.created_at
      from sellbase.refunds r join sellbase.payments p on p.id = r.payment_id
     where p.order_id = ${id} order by r.created_at`;
  const events = await sql`
    select type, message, data, actor_type, created_at from sellbase.order_events
     where order_id = ${id} order by created_at, id`;
  return { ...order, items, payments, fulfillments, refunds, events } as never;
}

export function registerOrders(app: Hono, deps: Deps, options: AppOptions) {
  const { sql } = deps;

  register(app, deps, options, routes.ordersList, async ({ storeId, query }) => {
    const after = decodeCursor(query.cursor);
    const number = query.q && /^#?\d+$/.test(query.q) ? Number(query.q.replace('#', '')) : null;
    const rows = await sql<{ id: string; placed_at: Date }[]>`
      select id, number, channel, email::text as email, currency::text as currency, total_amount,
             status, payment_status, fulfillment_status, placed_at
        from sellbase.orders
       where store_id = ${storeId}
         ${query.status ? sql`and status = ${query.status}` : sql``}
         ${query.payment_status ? sql`and payment_status = ${query.payment_status}` : sql``}
         ${query.channel ? sql`and channel = ${query.channel}` : sql``}
         ${query.fulfillment_status ? sql`and fulfillment_status = ${query.fulfillment_status}` : sql``}
         ${query.from ? sql`and placed_at >= ${query.from}` : sql``}
         ${query.to ? sql`and placed_at < ${query.to}` : sql``}
         ${query.q ? (number !== null ? sql`and number = ${number}` : sql`and email ilike ${'%' + query.q + '%'}`) : sql``}
         ${after ? sql`and (placed_at, id) < (${after.at}, ${after.id})` : sql``}
       order by placed_at desc, id desc limit ${query.limit + 1}`;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page as never,
      next_cursor: rows.length > query.limit && last ? encodeCursor(last.placed_at, last.id) : null,
    };
  });

  register(app, deps, options, routes.orderGet, ({ storeId, params }) =>
    loadOrderDetail(sql, storeId, params.id),
  );
}
