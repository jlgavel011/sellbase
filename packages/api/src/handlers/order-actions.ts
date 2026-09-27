import { derivePaymentStatus, formatMoney, routes, sellbaseError } from '@sellbase/core';
import type { Hono } from 'hono';
import type { TransactionSql } from 'postgres';
import { actorRef, authorize, type Actor } from '../auth.js';
import type { Deps } from '../deps.js';
import { notFound } from '../errors.js';
import { refreshOrderStatus } from '../fulfillment.js';
import { register, type AppOptions } from '../http.js';
import { kickJobs } from '../jobs.js';
import { loadOrderDetail } from './orders.js';

interface OrderRow {
  id: string;
  store_id: string;
  number: number;
  status: string;
  currency: string;
  amount_paid: number;
  amount_refunded: number;
  total_amount: number;
}

async function lockOrder(tx: TransactionSql, storeId: string, id: string): Promise<OrderRow> {
  const [order] = await tx<OrderRow[]>`
    select id, store_id, number, status, currency::text as currency, amount_paid, amount_refunded, total_amount
      from sellbase.orders where id = ${id} and store_id = ${storeId} for update`;
  if (!order) throw notFound('Order', id, 'Search orders with GET /orders.');
  return order;
}

async function timeline(
  tx: TransactionSql,
  order: OrderRow,
  actor: Actor | null,
  type: string,
  message: string,
  data: object = {},
) {
  const { actor_type, actor_id } = actorRef(actor);
  await tx`
    insert into sellbase.order_events (store_id, order_id, type, message, data, actor_type, actor_id)
    values (${order.store_id}, ${order.id}, ${type}, ${message}, ${tx.json(data as never)}, ${actor_type}, ${actor_id})`;
  await tx`
    insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, entity_id, diff)
    values (${order.store_id}, ${actor_type}, ${actor_id}, ${type}, 'order', ${order.id}, ${tx.json(data as never)})`;
}

/**
 * Refunds through the provider. A pending row is written first so its id can be the
 * provider idempotency key: a retried request never refunds twice.
 */
export async function refundOrder(
  deps: Deps,
  storeId: string,
  orderId: string,
  actor: Actor | null,
  amount: number | undefined,
  reason: string,
  notify: boolean,
) {
  const { sql } = deps;
  const payments = await deps.payments(storeId);
  if (!payments) {
    throw sellbaseError(
      'VALIDATION_ERROR',
      'No payment provider is connected.',
      'Connect Stripe before refunding: POST /integrations/stripe/connect.',
    );
  }

  const prepared = await sql.begin(async (tx) => {
    const order = await lockOrder(tx, storeId, orderId);
    const refundable = order.amount_paid - order.amount_refunded;
    const value = amount ?? refundable;
    if (refundable <= 0) {
      throw sellbaseError(
        'VALIDATION_ERROR',
        `Order #${order.number} has nothing left to refund.`,
        'Check the order payments and refunds with order_get.',
      );
    }
    if (value > refundable) {
      throw sellbaseError(
        'VALIDATION_ERROR',
        `Only ${formatMoney(refundable, order.currency)} can still be refunded on order #${order.number}.`,
        `Send amount ≤ ${refundable} (minor units) or omit it to refund everything left.`,
        { refundable },
      );
    }
    const [payment] = await tx<{ id: string; provider_payment_id: string }[]>`
      select id, provider_payment_id from sellbase.payments
       where order_id = ${order.id} and status = 'succeeded' and provider_payment_id is not null
       order by amount desc limit 1`;
    if (!payment)
      throw sellbaseError(
        'VALIDATION_ERROR',
        'This order has no provider payment to refund.',
        'Refund it outside Sellbase and add a note.',
      );
    const { actor_id } = actorRef(actor);
    const [row] = await tx<{ id: string }[]>`
      insert into sellbase.refunds (store_id, payment_id, amount, reason, status, created_by)
      values (${storeId}, ${payment.id}, ${value}, ${reason}, 'pending', ${actor_id}) returning id`;
    return {
      order,
      value,
      refundId: row?.id ?? '',
      providerPaymentId: payment.provider_payment_id,
    };
  });

  let result;
  try {
    result = await payments.refund({
      provider_payment_id: prepared.providerPaymentId,
      amount: prepared.value,
      reason,
      idempotency_key: `refund-${prepared.refundId}`,
    });
  } catch (error) {
    await sql`update sellbase.refunds set status = 'failed' where id = ${prepared.refundId}`;
    throw error;
  }

  await sql.begin(async (tx) => {
    const order = await lockOrder(tx, storeId, orderId);
    await tx`update sellbase.refunds set status = ${result.status}, provider_refund_id = ${result.provider_refund_id} where id = ${prepared.refundId}`;
    if (result.status === 'failed') {
      throw sellbaseError(
        'VALIDATION_ERROR',
        'The payment provider rejected the refund.',
        'Check the payment in the Stripe dashboard.',
      );
    }
    const refunded = order.amount_refunded + prepared.value;
    await tx`
      update sellbase.orders set amount_refunded = ${refunded},
             payment_status = ${derivePaymentStatus({ total_amount: order.total_amount, amount_paid: order.amount_paid, amount_refunded: refunded })}
       where id = ${order.id}`;
    await timeline(
      tx,
      order,
      actor,
      'refund.created',
      `Refunded ${formatMoney(prepared.value, order.currency)}: ${reason}`,
      { amount: prepared.value, refund_id: prepared.refundId, reason },
    );
    await tx`select sellbase.emit_event(${storeId}, 'refund.created', 'order', ${order.id}, ${tx.json({ amount: prepared.value, notify } as never)})`;
  });
  return prepared.value;
}

export function registerOrderActions(app: Hono, deps: Deps, options: AppOptions) {
  const { sql } = deps;

  register(app, deps, options, routes.orderFulfill, async ({ storeId, actor, params, body }) => {
    await sql.begin(async (tx) => {
      const order = await lockOrder(tx, storeId, params.id);
      if (order.status !== 'open') {
        throw sellbaseError(
          'INVALID_TRANSITION',
          `Order #${order.number} is ${order.status}; only open orders can be fulfilled.`,
          'Check the order status with order_get.',
        );
      }
      const pending = await tx<{ id: string; title: string; remaining: number }[]>`
        select id, title, quantity - fulfilled_quantity as remaining from sellbase.order_items
         where order_id = ${order.id} and fulfillment_type = 'shipment' and fulfilled_quantity < quantity for update`;
      const byId = new Map(pending.map((i) => [i.id, i]));
      const items =
        body.items ?? pending.map((i) => ({ order_item_id: i.id, quantity: i.remaining }));
      if (items.length === 0) {
        throw sellbaseError(
          'VALIDATION_ERROR',
          `Order #${order.number} has nothing left to ship.`,
          'Digital items are delivered automatically; check order_get.',
        );
      }
      for (const item of items) {
        const line = byId.get(item.order_item_id);
        if (!line)
          throw sellbaseError(
            'VALIDATION_ERROR',
            `Item ${item.order_item_id} is not a pending shipment of this order.`,
            'Use item ids from order_get with fulfillment_type "shipment".',
          );
        if (item.quantity > line.remaining)
          throw sellbaseError(
            'VALIDATION_ERROR',
            `Only ${line.remaining} of "${line.title}" are left to ship.`,
            `Send quantity ≤ ${line.remaining}.`,
          );
      }
      const [fulfillment] = await tx<{ id: string }[]>`
        insert into sellbase.fulfillments (store_id, order_id, type, status, items)
        values (${storeId}, ${order.id}, 'shipment', 'fulfilled', ${tx.json(items as never)}) returning id`;
      await tx`
        insert into sellbase.shipments (store_id, fulfillment_id, carrier, tracking_number, tracking_url, status)
        values (${storeId}, ${fulfillment?.id ?? null}, ${body.carrier ?? null}, ${body.tracking_number ?? null}, ${body.tracking_url ?? null}, 'in_transit')`;
      for (const item of items) {
        await tx`update sellbase.order_items set fulfilled_quantity = fulfilled_quantity + ${item.quantity} where id = ${item.order_item_id}`;
      }
      await refreshOrderStatus(tx, order.id);
      await timeline(
        tx,
        order,
        actor,
        'fulfillment.created',
        `Shipped ${items.reduce((n, i) => n + i.quantity, 0)} item(s)${body.carrier ? ` with ${body.carrier}` : ''}${body.tracking_number ? ` (${body.tracking_number})` : ''}.`,
        {
          fulfillment_id: fulfillment?.id,
          carrier: body.carrier ?? null,
          tracking_number: body.tracking_number ?? null,
          quantity: items.reduce((n, i) => n + i.quantity, 0),
        },
      );
      await tx`select sellbase.emit_event(${storeId}, 'fulfillment.shipped', 'order', ${order.id}, ${tx.json({ fulfillment_id: fulfillment?.id, notify: body.notify_customer } as never)})`;
    });
    kickJobs(deps);
    return loadOrderDetail(sql, storeId, params.id);
  });

  register(app, deps, options, routes.orderRefund, async ({ storeId, actor, params, body }) => {
    await refundOrder(
      deps,
      storeId,
      params.id,
      actor,
      body.amount,
      body.reason,
      body.notify_customer,
    );
    kickJobs(deps);
    return loadOrderDetail(sql, storeId, params.id);
  });

  register(app, deps, options, routes.orderCancel, async ({ storeId, actor, params, body }) => {
    const [current] = await sql<{ status: string; number: number; refundable: number }[]>`
      select status, number, amount_paid - amount_refunded as refundable from sellbase.orders where id = ${params.id} and store_id = ${storeId}`;
    if (!current) throw notFound('Order', params.id, 'Search orders with GET /orders.');
    if (current.status !== 'open' && current.status !== 'pending_payment') {
      throw sellbaseError(
        'INVALID_TRANSITION',
        `Order #${current.number} is ${current.status} and cannot be cancelled.`,
        current.status === 'completed'
          ? 'Refund it instead (order_refund).'
          : 'It is already cancelled.',
      );
    }
    let refunded = 0;
    if (body.refund && current.refundable > 0) {
      authorize(actor, { kind: 'staff', scope: 'refunds:write' });
      refunded = await refundOrder(
        deps,
        storeId,
        params.id,
        actor,
        undefined,
        `Cancelled: ${body.reason}`,
        false,
      );
    }
    await sql.begin(async (tx) => {
      const order = await lockOrder(tx, storeId, params.id);
      if (body.restock) {
        const lines = await tx<{ variant_id: string; remaining: number }[]>`
          select variant_id, quantity - fulfilled_quantity as remaining from sellbase.order_items
           where order_id = ${order.id} and variant_id is not null and quantity > fulfilled_quantity`;
        const { actor_type, actor_id } = actorRef(actor);
        for (const line of lines) {
          const [tracked] =
            await tx`select 1 from sellbase.inventory_levels where variant_id = ${line.variant_id}`;
          if (tracked)
            await tx`select sellbase.adjust_inventory(${line.variant_id}, ${line.remaining}, 'order_cancelled', ${actor_type}, ${actor_id})`;
        }
      }
      await tx`update sellbase.digital_grants set expires_at = least(expires_at, now()) where order_id = ${order.id}`;
      await tx`update sellbase.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = ${body.reason} where id = ${order.id}`;
      await timeline(
        tx,
        order,
        actor,
        'order.cancelled',
        `Cancelled: ${body.reason}${refunded ? ` (refunded ${formatMoney(refunded, order.currency)})` : ''}.`,
        { restock: body.restock, refunded, reason: body.reason },
      );
      await tx`select sellbase.emit_event(${storeId}, 'order.cancelled', 'order', ${order.id}, ${tx.json({ notify: body.notify_customer, refunded_amount: refunded } as never)})`;
    });
    kickJobs(deps);
    return loadOrderDetail(sql, storeId, params.id);
  });

  register(app, deps, options, routes.orderNote, async ({ storeId, actor, params, body }) => {
    await sql.begin(async (tx) => {
      const order = await lockOrder(tx, storeId, params.id);
      await tx`update sellbase.orders set notes = concat_ws(E'\\n', notes, ${body.note}::text) where id = ${order.id}`;
      await timeline(tx, order, actor, 'note', body.note);
    });
    return loadOrderDetail(sql, storeId, params.id);
  });

  register(app, deps, options, routes.orderNotify, async ({ storeId, actor, params, body }) => {
    const email = await sql.begin(async (tx) => {
      const order = await lockOrder(tx, storeId, params.id);
      const [row] = await tx<
        { email: string }[]
      >`select email::text from sellbase.orders where id = ${order.id}`;
      await timeline(tx, order, actor, 'notification.requested', `Resend ${body.template}.`, {
        template: body.template,
      });
      await tx`select sellbase.emit_event(${storeId}, 'notification.requested', 'order', ${order.id}, ${tx.json({ template: body.template } as never)})`;
      return row?.email ?? '';
    });
    kickJobs(deps);
    return { queued: true, to: email };
  });
}
