import {
  calculateTotals,
  sellbaseError,
  storeSettings,
  type CartLineWithCatalog,
  type CartView,
  type PricingInput,
  type TaxSettings,
} from '@sellbase/core';
import type { Sql } from 'postgres';
import { notFound } from './errors.js';

type PricingDiscount = NonNullable<PricingInput['discounts']>[number];

export interface StoreRow {
  id: string;
  name: string;
  default_currency: string;
  default_locale: string;
  country: string;
  contact_email: string | null;
  logo_url: string | null;
  settings: unknown;
}

export async function loadStore(sql: Sql, storeId: string) {
  const [row] = await sql<StoreRow[]>`
    select id, name, default_currency, default_locale, country, contact_email, logo_url, settings
      from sellbase.stores where id = ${storeId}`;
  if (!row) throw notFound('Store', storeId, 'Run `sellbase init` to create the store.');
  const settings = storeSettings.parse(row.settings ?? {});
  return { ...row, settings, tax: settings.tax as TaxSettings };
}

interface DiscountRow {
  id: string;
  code: string | null;
  kind: 'percent' | 'fixed' | 'free_shipping';
  value: number;
  applies_to: PricingDiscount['applies_to'];
  min_subtotal_amount: number | null;
}

/**
 * Discounts that may apply now: every active automatic discount plus the given codes.
 * Validity (status, dates, usage limits) is decided here; eligibility by cart content is
 * decided by `calculateTotals`. Automatic discounts come first (ADR 0002).
 */
export async function loadDiscounts(
  sql: Sql,
  storeId: string,
  codes: readonly string[],
  now: Date,
): Promise<PricingDiscount[]> {
  const rows = await sql<DiscountRow[]>`
    select id, code::text, kind, value, applies_to, min_subtotal_amount
      from sellbase.discounts
     where store_id = ${storeId} and status = 'active'
       and (code is null or upper(code::text) = any(${sql.array(codes.map((c) => c.toUpperCase()))}))
       and (starts_at is null or starts_at <= ${now}) and (ends_at is null or ends_at > ${now})
       and (usage_limit is null or usage_count < usage_limit)
     order by (code is not null), created_at`;
  return rows.map((d) => ({ ...d, code: d.code?.toUpperCase() ?? null }));
}

/** Explains why a code the buyer typed cannot be used at all. */
export async function assertCodeUsable(sql: Sql, storeId: string, code: string, now: Date) {
  const [row] = await sql<
    {
      status: string;
      starts_at: Date | null;
      ends_at: Date | null;
      usage_limit: number | null;
      usage_count: number;
    }[]
  >`
    select status, starts_at, ends_at, usage_limit, usage_count from sellbase.discounts
     where store_id = ${storeId} and upper(code::text) = ${code.toUpperCase()}`;
  const hint = 'Check the code with the store, or continue without it.';
  if (!row || row.status !== 'active') {
    throw sellbaseError('DISCOUNT_NOT_APPLICABLE', `Discount code "${code}" is not valid.`, hint, {
      code,
    });
  }
  if ((row.starts_at && row.starts_at > now) || (row.ends_at && row.ends_at <= now)) {
    throw sellbaseError(
      'DISCOUNT_NOT_APPLICABLE',
      `Discount code "${code}" is not active right now.`,
      hint,
      { code },
    );
  }
  if (row.usage_limit !== null && row.usage_count >= row.usage_limit) {
    throw sellbaseError(
      'DISCOUNT_NOT_APPLICABLE',
      `Discount code "${code}" has reached its usage limit.`,
      hint,
      { code },
    );
  }
}

interface CartRow {
  id: string;
  token: string;
  currency: string;
  status: CartView['status'];
  email: string | null;
  discount_codes: string[];
}

export async function loadCart(sql: Sql, storeId: string, token: string) {
  const [cart] = await sql<CartRow[]>`
    select id, token, currency, status, email::text, discount_codes
      from sellbase.carts where store_id = ${storeId} and token = ${token}`;
  if (!cart) {
    throw sellbaseError(
      'NOT_FOUND',
      'Cart not found.',
      'Create a new cart with POST /storefront/carts.',
      {},
    );
  }
  return cart;
}

export function assertCartOpen(cart: CartRow) {
  if (cart.status !== 'open') {
    throw sellbaseError(
      'VALIDATION_ERROR',
      `This cart is ${cart.status} and can no longer change.`,
      'Create a new cart with POST /storefront/carts.',
      { status: cart.status },
    );
  }
}

type LineRow = CartLineWithCatalog & {
  product_slug: string;
  available_quantity: number | null;
  tracked_available: boolean;
};

export async function loadCartLines(sql: Sql, cartId: string): Promise<LineRow[]> {
  return sql<LineRow[]>`
    select ci.id as cart_item_id, v.id as variant_id, p.id as product_id, p.slug as product_slug,
           p.type as product_type, p.status as product_status, v.status as variant_status,
           p.title, nullif(v.title, 'Default') as variant_title, v.sku, v.price_amount as unit_price_amount,
           v.currency::text as currency, ci.quantity,
           coalesce((select array_agg(cp.collection_id) from sellbase.collection_products cp
                      where cp.product_id = p.id), '{}') as collection_ids,
           coalesce(ps.requires_shipping, p.type = 'physical') as requires_shipping,
           (select m.url from sellbase.product_media m where m.product_id = p.id order by m.position limit 1) as image_url,
           inv.available as available_quantity,
           (inv.tracked is not true or inv.backorder or inv.available >= ci.quantity) as tracked_available
      from sellbase.cart_items ci
      join sellbase.variants v on v.id = ci.variant_id
      join sellbase.products p on p.id = v.product_id
      left join sellbase.physical_specs ps on ps.variant_id = v.id
      left join lateral (
        select count(*) > 0 as tracked, sum(il.on_hand - il.reserved)::int as available,
               bool_or(il.policy = 'continue') as backorder
          from sellbase.inventory_levels il where il.variant_id = v.id
      ) inv on true
     where ci.cart_id = ${cartId}
     order by ci.created_at, ci.id`;
}

/** The cart as the storefront sees it, with totals always computed on the server. */
export async function cartView(
  sql: Sql,
  storeId: string,
  token: string,
  now: Date,
): Promise<CartView> {
  const store = await loadStore(sql, storeId);
  const cart = await loadCart(sql, storeId, token);
  const lines = await loadCartLines(sql, cart.id);
  const discounts = await loadDiscounts(sql, storeId, cart.discount_codes, now);
  const totals = calculateTotals({
    currency: cart.currency,
    lines: lines.map((l) => ({
      id: l.cart_item_id,
      unit_price_amount: l.unit_price_amount,
      quantity: l.quantity,
      product_id: l.product_id,
      collection_ids: l.collection_ids,
    })),
    discounts,
    tax: store.tax,
  });
  return {
    token: cart.token,
    currency: cart.currency,
    status: cart.status,
    email: cart.email,
    items: lines.map((l, i) => ({
      id: l.cart_item_id,
      variant_id: l.variant_id,
      product_id: l.product_id,
      product_slug: l.product_slug,
      title: l.title,
      variant_title: l.variant_title,
      sku: l.sku,
      image_url: l.image_url,
      unit_price_amount: l.unit_price_amount,
      quantity: l.quantity,
      subtotal_amount: totals.lines[i]?.subtotal_amount ?? 0,
      discount_amount: totals.lines[i]?.discount_amount ?? 0,
      total_amount: totals.lines[i]?.total_amount ?? 0,
      available:
        l.product_status === 'active' && l.variant_status === 'active' && l.tracked_available,
    })),
    discount_codes: cart.discount_codes,
    rejected_discounts: totals.rejected_discounts.map(({ code, reason, hint }) => ({
      code,
      reason,
      hint,
    })),
    requires_shipping: lines.some((l) => l.product_type === 'physical' && l.requires_shipping),
    totals: {
      currency: totals.currency,
      subtotal_amount: totals.subtotal_amount,
      discount_amount: totals.discount_amount,
      shipping_amount: totals.shipping_amount,
      tax_amount: totals.tax_amount,
      tax_mode: totals.tax_mode,
      total_amount: totals.total_amount,
    },
  };
}
