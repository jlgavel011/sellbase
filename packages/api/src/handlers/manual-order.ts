import {
  calculateTotals,
  fulfillmentTypeFor,
  routes,
  sellbaseError,
  type ManualOrderInput,
  type ProductType,
} from '@sellbase/core';
import type { Hono } from 'hono';
import { actorRef, type Actor } from '../auth.js';
import type { Deps } from '../deps.js';
import { register, type AppOptions } from '../http.js';
import { kickJobs } from '../jobs.js';
import { assertCodeUsable, loadDiscounts, loadStore } from '../pricing-context.js';
import { createPaymentLink } from './order-actions.js';
import { loadOrderDetail } from './orders.js';

interface VariantRow {
  variant_id: string;
  product_id: string;
  product_type: ProductType;
  title: string;
  variant_title: string | null;
  sku: string | null;
  price_amount: number;
  currency: string;
  status: string;
  product_status: string;
  requires_shipping: boolean;
  collection_ids: string[];
}

const METHODS: Record<string, string> = {
  cash: 'cash',
  spei: 'transfer',
  card: 'card terminal',
  other: 'other',
};

/**
 * Records a sale made outside the storefront (ADR 0009). Orders normally come only from
 * the payment webhook; this is the exception for money the store already received or will
 * collect with a payment link, always attributed to a staff member or token in audit_log.
 */
async function createManualOrder(
  deps: Deps,
  storeId: string,
  actor: Actor | null,
  input: ManualOrderInput,
) {
  const { sql } = deps;
  const now = deps.now();
  const paid = input.payment.mode === 'paid';
  if (paid && input.confirm !== true) {
    throw sellbaseError(
      'VALIDATION_ERROR',
      'Recording a paid order needs confirm: true.',
      'Check the total with the owner, then send the same request with confirm: true.',
    );
  }
  const store = await loadStore(sql, storeId);
  const currency = store.default_currency;

  if (input.payment.mode === 'link') {
    if (!(await deps.payments(storeId))) {
      throw sellbaseError(
        'VALIDATION_ERROR',
        'No payment provider is connected, so there is no way to send a payment link.',
        'Connect Stripe (POST /integrations/stripe/connect) or record the order as paid.',
      );
    }
    const settings = store.settings as { site_url?: string };
    if (!input.payment.success_url && !settings.site_url) {
      throw sellbaseError(
        'VALIDATION_ERROR',
        'Where should the customer land after paying?',
        'Send payment.success_url, or set settings.site_url on the store (PATCH /store).',
      );
    }
  }

  const ids = input.items.map((i) => i.variant_id);
  const variants = await sql<VariantRow[]>`
    select v.id as variant_id, p.id as product_id, p.type as product_type, p.title,
           nullif(v.title, 'Default') as variant_title, v.sku, v.price_amount, v.currency::text as currency,
           v.status, p.status as product_status,
           coalesce(ps.requires_shipping, p.type = 'physical') as requires_shipping,
           coalesce((select array_agg(cp.collection_id) from sellbase.collection_products cp
                      where cp.product_id = p.id), '{}') as collection_ids
      from sellbase.variants v
      join sellbase.products p on p.id = v.product_id
      left join sellbase.physical_specs ps on ps.variant_id = v.id
     where v.store_id = ${storeId} and v.id = any(${sql.array(ids)}::uuid[])`;
  const lines = input.items.map((item, index) => {
    const v = variants.find((x) => x.variant_id === item.variant_id);
    if (!v || v.status === 'archived' || v.product_status === 'archived') {
      throw sellbaseError(
        'NOT_FOUND',
        `items[${index}]: variant ${item.variant_id} does not exist or is archived.`,
        'Use variant ids from products_search / GET /products.',
        { variant_id: item.variant_id },
      );
    }
    if (v.product_type === 'service') {
      throw sellbaseError(
        'VALIDATION_ERROR',
        `items[${index}]: "${v.title}" is a service and needs a time slot.`,
        'Book services from the storefront (booking-picker) so the slot is reserved.',
      );
    }
    if (v.currency !== currency) {
      throw sellbaseError(
        'CURRENCY_MISMATCH',
        `items[${index}]: "${v.title}" is priced in ${v.currency}, the store sells in ${currency}.`,
        'Use variants in the store currency.',
      );
    }
    return {
      ...v,
      quantity: item.quantity,
      unit_price_amount: item.unit_price_amount ?? v.price_amount,
    };
  });

  const codes = input.discount_codes ?? [];
  for (const code of codes) await assertCodeUsable(sql, storeId, code, now);
  const discounts = await loadDiscounts(sql, storeId, codes, now);
  const totals = calculateTotals({
    currency,
    lines: lines.map((l, i) => ({
      id: String(i),
      unit_price_amount: l.unit_price_amount,
      quantity: l.quantity,
      product_id: l.product_id,
      collection_ids: l.collection_ids,
    })),
    discounts,
    shipping_amount: input.shipping_amount,
    tax: store.tax,
  });
  const { actor_type, actor_id } = actorRef(actor);
  const channel = input.channel ?? (actor?.type === 'token' ? 'agent' : 'admin');

  const orderId = await sql.begin(async (tx) => {
    const [customer] = await tx<{ id: string }[]>`
      insert into sellbase.customers (store_id, email, phone, first_name, last_name)
      values (${storeId}, ${input.email}, ${input.phone ?? null}, ${input.first_name ?? null}, ${input.last_name ?? null})
      on conflict (store_id, email) do update set
        phone = coalesce(excluded.phone, sellbase.customers.phone),
        first_name = coalesce(excluded.first_name, sellbase.customers.first_name),
        last_name = coalesce(excluded.last_name, sellbase.customers.last_name)
      returning id`;
    const [order] = await tx<{ id: string; number: number }[]>`
      insert into sellbase.orders
        (store_id, number, channel, customer_id, email, phone, currency, subtotal_amount, discount_amount,
         shipping_amount, tax_amount, total_amount, amount_paid, status, payment_status, shipping_address, notes)
      values
        (${storeId}, sellbase.next_order_number(${storeId}), ${channel}, ${customer?.id ?? null}, ${input.email},
         ${input.phone ?? null}, ${currency}, ${totals.subtotal_amount}, ${totals.discount_amount},
         ${totals.shipping_amount}, ${totals.tax_amount}, ${totals.total_amount},
         ${paid ? totals.total_amount : 0}, ${paid ? 'open' : 'pending_payment'},
         sellbase.derive_payment_status(${totals.total_amount}::bigint, ${paid ? totals.total_amount : 0}::bigint, 0),
         ${input.shipping_address ? tx.json(input.shipping_address as never) : null}, ${input.note ?? null})
      returning id, number`;
    if (!order) throw new Error('order insert returned no row');

    for (const [i, l] of lines.entries()) {
      const priced = totals.lines[i];
      await tx`
        insert into sellbase.order_items
          (store_id, order_id, variant_id, product_id, product_type, title, variant_title, sku,
           unit_price_amount, quantity, discount_amount, tax_amount, total_amount, fulfillment_type)
        values
          (${storeId}, ${order.id}, ${l.variant_id}, ${l.product_id}, ${l.product_type}, ${l.title},
           ${l.variant_title}, ${l.sku}, ${l.unit_price_amount}, ${l.quantity}, ${priced?.discount_amount ?? 0},
           ${priced?.tax_amount ?? 0}, ${priced?.total_amount ?? 0},
           ${fulfillmentTypeFor(l.product_type, l.requires_shipping)})`;
      // Stock leaves now; the level with most free units gives it. `deny` never goes negative.
      await tx`
        update sellbase.inventory_levels set on_hand = on_hand - ${l.quantity}
         where id = (select id from sellbase.inventory_levels where variant_id = ${l.variant_id}
                      order by on_hand - reserved desc limit 1)`;
    }

    for (const d of totals.applied_discounts) {
      await tx`
        insert into sellbase.discount_redemptions (store_id, discount_id, order_id, customer_id)
        values (${storeId}, ${d.id}, ${order.id}, ${customer?.id ?? null})`;
      await tx`update sellbase.discounts set usage_count = usage_count + 1 where id = ${d.id}`;
    }

    if (paid && input.payment.mode === 'paid') {
      await tx`
        insert into sellbase.payments (store_id, order_id, provider, provider_payment_id, method, kind, amount, currency, status, raw)
        values (${storeId}, ${order.id}, 'manual', null, ${input.payment.method},
                'charge', ${totals.total_amount}, ${currency}, 'succeeded',
                ${tx.json({ reference: input.payment.reference ?? null, recorded_by: actor_id } as never)})`;
    }
    const how =
      input.payment.mode === 'paid'
        ? `paid by ${METHODS[input.payment.method] ?? input.payment.method}`
        : 'waiting for payment link';
    await tx`
      insert into sellbase.order_events (store_id, order_id, type, message, data, actor_type, actor_id)
      values (${storeId}, ${order.id}, 'order.created', ${`Manual order recorded (${how}).`},
              ${tx.json({ channel, payment: input.payment } as never)}, ${actor_type}, ${actor_id})`;
    await tx`
      insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, entity_id, diff)
      values (${storeId}, ${actor_type}, ${actor_id}, 'order.create_manual', 'order', ${order.id},
              ${tx.json({ total_amount: totals.total_amount, payment: input.payment, channel } as never)})`;
    await tx`select sellbase.emit_event(${storeId}, 'order.created', 'order', ${order.id})`;
    if (paid) {
      await tx`select sellbase.emit_event(${storeId}, 'payment.succeeded', 'order', ${order.id}, ${tx.json({ amount: totals.total_amount, manual: true } as never)})`;
      await tx`select sellbase.emit_event(${storeId}, 'order.paid', 'order', ${order.id}, ${tx.json({ notify: input.notify_customer } as never)})`;
    }
    return order.id;
  });

  let paymentUrl: string | null = null;
  if (input.payment.mode === 'link') {
    const link = await createPaymentLink(deps, storeId, actor, orderId, {
      success_url: input.payment.success_url,
    });
    paymentUrl = link.url;
  }
  kickJobs(deps);
  return { order: await loadOrderDetail(sql, storeId, orderId), payment_url: paymentUrl };
}

export function registerManualOrders(app: Hono, deps: Deps, options: AppOptions) {
  register(app, deps, options, routes.orderCreate, ({ storeId, actor, body }) =>
    createManualOrder(deps, storeId, actor, body),
  );
}
