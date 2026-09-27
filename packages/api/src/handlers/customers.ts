import { routes } from '@sellbase/core';
import type { Hono } from 'hono';
import type { Deps } from '../deps.js';
import { notFound } from '../errors.js';
import { register, type AppOptions } from '../http.js';
import { decodeCursor, encodeCursor } from '../pagination.js';
import { BOOKING_SELECT } from '../services.js';

/** Orders that count as sales: paid, not cancelled and not made by test_purchase. */
export const SOLD = `o.status in ('open', 'completed') and (o.metadata->>'test_purchase') is distinct from 'true'`;

export function registerCustomers(app: Hono, deps: Deps, options: AppOptions) {
  const { sql } = deps;

  register(app, deps, options, routes.customersList, async ({ storeId, query }) => {
    const after = decodeCursor(query.cursor);
    const like = query.q ? `%${query.q}%` : null;
    const rows = await sql<{ id: string; created_at: Date }[]>`
      select c.id, c.email::text as email, c.phone, c.first_name, c.last_name, c.accepts_marketing, c.created_at,
             count(o.id)::int as orders_count,
             coalesce(sum(o.amount_paid - o.amount_refunded), 0)::bigint as total_spent_amount,
             max(o.placed_at) as last_order_at
        from sellbase.customers c
        left join sellbase.orders o on o.customer_id = c.id and ${sql.unsafe(SOLD)}
       where c.store_id = ${storeId}
         ${
           like
             ? sql`and (c.email ilike ${like} or concat_ws(' ', c.first_name, c.last_name) ilike ${like} or c.phone ilike ${like})`
             : sql``
         }
         ${after ? sql`and (c.created_at, c.id) < (${after.at}, ${after.id})` : sql``}
       group by c.id
       order by c.created_at desc, c.id desc limit ${query.limit + 1}`;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page as never,
      next_cursor:
        rows.length > query.limit && last ? encodeCursor(last.created_at, last.id) : null,
    };
  });

  register(app, deps, options, routes.customerGet, async ({ storeId, params }) => {
    const [customer] = await sql`
      select c.id, c.email::text as email, c.phone, c.first_name, c.last_name, c.auth_user_id,
             c.accepts_marketing, c.marketing_consent_at, c.locale, c.metadata, c.created_at, c.updated_at,
             s.default_currency::text as currency,
             (select count(*)::int from sellbase.orders o where o.customer_id = c.id and ${sql.unsafe(SOLD)}) as orders_count,
             (select coalesce(sum(o.amount_paid - o.amount_refunded), 0)::bigint
                from sellbase.orders o where o.customer_id = c.id and ${sql.unsafe(SOLD)}) as total_spent_amount
        from sellbase.customers c join sellbase.stores s on s.id = c.store_id
       where c.id = ${params.id} and c.store_id = ${storeId}`;
    if (!customer) throw notFound('Customer', params.id, 'Search customers with GET /customers.');
    const [addresses, orders, bookings] = await Promise.all([
      sql`
        select id, label, line1, line2, city, state, postal_code, country::text as country, phone, is_default
          from sellbase.customer_addresses where customer_id = ${params.id} order by is_default desc, created_at`,
      sql`
        select id, number, channel, email::text as email, currency::text as currency, total_amount,
               status, payment_status, fulfillment_status, placed_at
          from sellbase.orders where customer_id = ${params.id} and store_id = ${storeId}
         order by placed_at desc limit 50`,
      sql`
        select ${sql.unsafe(BOOKING_SELECT)}
          from sellbase.bookings b
          join sellbase.resources r on r.id = b.resource_id
          left join sellbase.products p on p.id = b.product_id
          left join sellbase.orders o on o.id = b.order_id
         where b.store_id = ${storeId} and b.status <> 'held' and b.status <> 'expired'
           and (o.customer_id = ${params.id} or b.email = ${customer.email as string})
         order by b.starts_at desc limit 50`,
    ]);
    return { ...customer, addresses, orders, bookings } as never;
  });
}
