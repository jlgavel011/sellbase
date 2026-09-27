import { routes } from '@sellbase/core';
import type { Hono } from 'hono';
import type { Deps } from '../deps.js';
import { notFound } from '../errors.js';
import { register, type AppOptions } from '../http.js';
import { SOLD } from './customers.js';

interface Day {
  date: string;
  amount: number;
  orders: number;
}

function period(days: readonly Day[]) {
  const amount = days.reduce((sum, d) => sum + d.amount, 0);
  const orders = days.reduce((sum, d) => sum + d.orders, 0);
  return { amount, orders, average_order_amount: orders ? Math.round(amount / orders) : 0 };
}

export function registerReports(app: Hono, deps: Deps, options: AppOptions) {
  const { sql } = deps;

  register(app, deps, options, routes.reportsSummary, async ({ storeId }) => {
    const [store] = await sql<{ currency: string; timezone: string }[]>`
      select default_currency::text as currency, timezone from sellbase.stores where id = ${storeId}`;
    if (!store) throw notFound('Store', storeId, 'Run `sellbase init` to create the store.');
    const tz = store.timezone;
    const now = deps.now();
    // Sales = paid minus refunded on non-cancelled orders, by local day of placement.
    const daily = await sql<Day[]>`
      with days as (
        select generate_series((${now}::timestamptz at time zone ${tz})::date - 29,
                               (${now}::timestamptz at time zone ${tz})::date, interval '1 day')::date as d
      )
      select to_char(days.d, 'YYYY-MM-DD') as date,
             coalesce(sum(o.amount_paid - o.amount_refunded), 0)::bigint as amount,
             count(o.id)::int as orders
        from days
        left join sellbase.orders o
          on o.store_id = ${storeId} and ${sql.unsafe(SOLD)}
         and o.currency = ${store.currency} and (o.placed_at at time zone ${tz})::date = days.d
       group by days.d order by days.d`;
    const [top, pending] = await Promise.all([
      sql<{ product_id: string | null; title: string; quantity: number; amount: number }[]>`
        select v.product_id, oi.title, sum(oi.quantity)::int as quantity, sum(oi.total_amount)::bigint as amount
          from sellbase.order_items oi
          join sellbase.orders o on o.id = oi.order_id
          left join sellbase.variants v on v.id = oi.variant_id
         where o.store_id = ${storeId} and ${sql.unsafe(SOLD)} and o.currency = ${store.currency}
           and o.placed_at >= ${now}::timestamptz - interval '30 days'
         group by v.product_id, oi.title
         order by amount desc, quantity desc limit 5`,
      sql<{ orders_to_fulfill: number; bookings_today: number }[]>`
        select
          (select count(*)::int from sellbase.orders o
            where o.store_id = ${storeId} and o.status = 'open' and ${sql.unsafe(SOLD)}
              and exists (select 1 from sellbase.order_items oi
                           where oi.order_id = o.id and oi.fulfillment_type = 'shipment'
                             and oi.fulfilled_quantity < oi.quantity)) as orders_to_fulfill,
          (select count(*)::int from sellbase.bookings
            where store_id = ${storeId} and status in ('confirmed', 'completed', 'no_show')
              and (starts_at at time zone ${tz})::date = (${now}::timestamptz at time zone ${tz})::date) as bookings_today`,
    ]);
    return {
      currency: store.currency,
      timezone: tz,
      sales: {
        today: period(daily.slice(-1)),
        last_7_days: period(daily.slice(-7)),
        last_30_days: period(daily),
      },
      daily: [...daily],
      top_products: [...top],
      orders_to_fulfill: pending[0]?.orders_to_fulfill ?? 0,
      bookings_today: pending[0]?.bookings_today ?? 0,
    };
  });
}
