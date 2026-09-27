import { sellbaseError } from './errors.js';
import { calculateTotals, type PricingInput, type Totals } from './pricing.js';
import type { ProductType } from './schemas/index.js';

/**
 * Turns cart lines (joined with live catalog data) into the priced snapshot that
 * `sellbase.create_checkout_session` freezes. Pure: the API loads the data, this decides.
 */

export type FulfillmentType = 'shipment' | 'digital' | 'booking' | 'none';

export function fulfillmentTypeFor(type: ProductType, requiresShipping: boolean): FulfillmentType {
  switch (type) {
    case 'physical':
      return requiresShipping ? 'shipment' : 'none';
    case 'digital':
      return 'digital';
    case 'service':
      return 'booking';
  }
}

export interface CartLineWithCatalog {
  cart_item_id: string;
  variant_id: string;
  product_id: string;
  product_type: ProductType;
  product_status: 'draft' | 'active' | 'archived';
  variant_status: 'draft' | 'active' | 'archived';
  title: string;
  variant_title: string | null;
  sku: string | null;
  unit_price_amount: number;
  currency: string;
  quantity: number;
  collection_ids: string[];
  requires_shipping: boolean;
  image_url: string | null;
}

export interface CheckoutLineSnapshot {
  variant_id: string;
  product_id: string;
  product_type: ProductType;
  title: string;
  variant_title: string | null;
  sku: string | null;
  unit_price_amount: number;
  quantity: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  fulfillment_type: FulfillmentType;
  image_url: string | null;
}

export interface CheckoutPlan {
  totals: Totals;
  lines: CheckoutLineSnapshot[];
  requires_shipping: boolean;
}

export function planCheckout(input: {
  currency: string;
  lines: readonly CartLineWithCatalog[];
  discounts?: PricingInput['discounts'];
  shipping_amount?: number;
  tax?: PricingInput['tax'];
}): CheckoutPlan {
  if (input.lines.length === 0) {
    throw sellbaseError(
      'VALIDATION_ERROR',
      'The cart is empty.',
      'Add at least one item before starting checkout.',
    );
  }
  for (const line of input.lines) {
    if (line.product_status !== 'active' || line.variant_status !== 'active') {
      throw sellbaseError(
        'NOT_FOUND',
        `"${line.title}" is no longer available.`,
        'Remove it from the cart and retry checkout.',
        { variant_id: line.variant_id, cart_item_id: line.cart_item_id },
      );
    }
    if (line.currency !== input.currency) {
      throw sellbaseError(
        'CURRENCY_MISMATCH',
        `"${line.title}" is priced in ${line.currency} but the cart uses ${input.currency}.`,
        `Only add products priced in ${input.currency}, or create a new cart in ${line.currency}.`,
        { variant_id: line.variant_id, expected: input.currency, got: line.currency },
      );
    }
  }

  const requiresShipping = input.lines.some(
    (l) => fulfillmentTypeFor(l.product_type, l.requires_shipping) === 'shipment',
  );
  const totals = calculateTotals({
    currency: input.currency,
    lines: input.lines.map((l) => ({
      id: l.cart_item_id,
      unit_price_amount: l.unit_price_amount,
      quantity: l.quantity,
      product_id: l.product_id,
      collection_ids: l.collection_ids,
    })),
    ...(input.discounts ? { discounts: input.discounts } : {}),
    shipping_amount: requiresShipping ? (input.shipping_amount ?? 0) : 0,
    ...(input.tax ? { tax: input.tax } : {}),
  });

  const lines = input.lines.map((l, i): CheckoutLineSnapshot => {
    const priced = totals.lines[i];
    return {
      variant_id: l.variant_id,
      product_id: l.product_id,
      product_type: l.product_type,
      title: l.title,
      variant_title: l.variant_title,
      sku: l.sku,
      unit_price_amount: l.unit_price_amount,
      quantity: l.quantity,
      discount_amount: priced?.discount_amount ?? 0,
      tax_amount: priced?.tax_amount ?? 0,
      total_amount: priced?.total_amount ?? 0,
      fulfillment_type: fulfillmentTypeFor(l.product_type, l.requires_shipping),
      image_url: l.image_url,
    };
  });

  return { totals, lines, requires_shipping: requiresShipping };
}
