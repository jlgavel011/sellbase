import { toLocale, type OrderConfirmationProps } from '@sellbase/emails';
import {
  deriveFulfillmentStatus,
  shouldCompleteOrder,
  type FulfillmentStatus,
  type OrderStatus,
  type PaymentStatus,
} from '@sellbase/core';
import type { TransactionSql } from 'postgres';
import { randomToken, sha256Hex } from './auth.js';
import type { Deps } from './deps.js';

export interface DownloadLink {
  file_name: string;
  url: string;
  expires_at: Date;
}

/**
 * Digital delivery (SPEC §9): one grant per purchased asset with its own token, expiry
 * and download limit. The plain token only leaves this function inside the email link.
 */
export async function fulfillDigital(
  deps: Deps,
  tx: TransactionSql,
  orderId: string,
): Promise<DownloadLink[]> {
  const items = await tx<
    {
      id: string;
      store_id: string;
      customer_id: string | null;
      variant_id: string;
      quantity: number;
    }[]
  >`
    select i.id, i.store_id, o.customer_id, i.variant_id, i.quantity
      from sellbase.order_items i join sellbase.orders o on o.id = i.order_id
     where i.order_id = ${orderId} and i.fulfillment_type = 'digital' and i.fulfilled_quantity < i.quantity
     for update of i`;
  if (items.length === 0) return [];

  const storeId = items[0]?.store_id ?? '';
  const [fulfillment] = await tx<{ id: string }[]>`
    insert into sellbase.fulfillments (store_id, order_id, type, status, items)
    values (${storeId}, ${orderId}, 'digital', 'fulfilled',
            ${tx.json(items.map((i) => ({ order_item_id: i.id, quantity: i.quantity })) as never)})
    returning id`;
  const links: DownloadLink[] = [];
  for (const item of items) {
    const assets = await tx<
      { id: string; file_name: string; download_limit: number | null; link_ttl_hours: number }[]
    >`
      select id, file_name, download_limit, link_ttl_hours from sellbase.digital_assets where variant_id = ${item.variant_id}`;
    for (const asset of assets) {
      const token = randomToken(32);
      const expiresAt = new Date(deps.now().getTime() + asset.link_ttl_hours * 3_600_000);
      await tx`
        insert into sellbase.digital_grants (store_id, fulfillment_id, order_id, digital_asset_id, customer_id,
                                             token_hash, download_limit, expires_at)
        values (${storeId}, ${fulfillment?.id ?? null}, ${orderId}, ${asset.id}, ${item.customer_id},
                ${await sha256Hex(token)}, ${asset.download_limit}, ${expiresAt})`;
      links.push({
        file_name: asset.file_name,
        url: `${deps.publicApiUrl}/v1/storefront/downloads/${token}`,
        expires_at: expiresAt,
      });
    }
    await tx`update sellbase.order_items set fulfilled_quantity = quantity where id = ${item.id}`;
  }
  await tx`select sellbase.emit_event(${storeId}, 'digital.granted', 'order', ${orderId})`;
  await tx`select sellbase.emit_event(${storeId}, 'fulfillment.created', 'order', ${orderId})`;
  await tx`
    insert into sellbase.order_events (store_id, order_id, type, message, data)
    values (${storeId}, ${orderId}, 'digital.granted', ${`Download links issued for ${links.length} file(s).`},
            ${tx.json({ files: links.map((l) => l.file_name) } as never)})`;
  return links;
}

/** Recomputes fulfillment status and completes the order when paid and fully delivered. */
export async function refreshOrderStatus(tx: TransactionSql, orderId: string) {
  const lines = await tx<{ quantity: number; fulfilled_quantity: number }[]>`
    select quantity, fulfilled_quantity from sellbase.order_items
     where order_id = ${orderId} and fulfillment_type <> 'none'`;
  const fulfillment: FulfillmentStatus = deriveFulfillmentStatus(lines);
  const [order] = await tx<
    {
      store_id: string;
      status: OrderStatus;
      payment_status: PaymentStatus;
      fulfillment_status: FulfillmentStatus;
    }[]
  >`
    update sellbase.orders set fulfillment_status = ${fulfillment} where id = ${orderId}
    returning store_id, status, payment_status, fulfillment_status`;
  if (order && shouldCompleteOrder(order)) {
    await tx`update sellbase.orders set status = 'completed' where id = ${orderId}`;
    await tx`select sellbase.emit_event(${order.store_id}, 'order.completed', 'order', ${orderId})`;
  }
}

export async function loadOrderEmailProps(
  tx: TransactionSql,
  orderId: string,
  links: DownloadLink[],
): Promise<(OrderConfirmationProps & { email: string }) | null> {
  const [order] = await tx<
    {
      number: number;
      email: string;
      currency: string;
      subtotal_amount: number;
      discount_amount: number;
      shipping_amount: number;
      tax_amount: number;
      total_amount: number;
      store_name: string;
      logo_url: string | null;
      contact_email: string | null;
      default_locale: string;
      settings: { brand_color?: string; tax?: { mode?: 'inclusive' | 'exclusive' } };
    }[]
  >`
    select o.number, o.email::text as email, o.currency::text as currency, o.subtotal_amount, o.discount_amount,
           o.shipping_amount, o.tax_amount, o.total_amount, s.name as store_name, s.logo_url,
           s.contact_email::text as contact_email, s.default_locale, s.settings
      from sellbase.orders o join sellbase.stores s on s.id = o.store_id where o.id = ${orderId}`;
  if (!order) return null;
  const items = await tx<
    {
      title: string;
      variant_title: string | null;
      quantity: number;
      total_amount: number;
      fulfillment_type: string;
    }[]
  >`
    select title, variant_title, quantity, total_amount, fulfillment_type from sellbase.order_items
     where order_id = ${orderId} order by created_at, id`;
  return {
    email: order.email,
    locale: toLocale(order.default_locale),
    brand: {
      store_name: order.store_name,
      logo_url: order.logo_url,
      brand_color: order.settings.brand_color ?? null,
      contact_email: order.contact_email,
    },
    order: {
      number: order.number,
      currency: order.currency,
      subtotal_amount: order.subtotal_amount,
      discount_amount: order.discount_amount,
      shipping_amount: order.shipping_amount,
      tax_amount: order.tax_amount,
      tax_mode: order.settings.tax?.mode ?? 'inclusive',
      total_amount: order.total_amount,
      items: items.map(({ title, variant_title, quantity, total_amount }) => ({
        title,
        variant_title,
        quantity,
        total_amount,
      })),
      requires_shipping: items.some((i) => i.fulfillment_type === 'shipment'),
    },
    downloads: links.map((l) => ({
      file_name: l.file_name,
      url: l.url,
      expires_at: l.expires_at.toISOString(),
    })),
  };
}
