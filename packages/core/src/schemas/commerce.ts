import { z } from 'zod';
import { address, amount, currency, email, id, locale, metadata, timestamp } from './common.js';
import { productType } from './catalog.js';

// ── Customers ────────────────────────────────────────────────────────────────

export const customer = z.object({
  id,
  email,
  phone: z.string().max(30).nullable(),
  first_name: z.string().max(100).nullable(),
  last_name: z.string().max(100).nullable(),
  auth_user_id: id.nullable(),
  accepts_marketing: z.boolean(),
  marketing_consent_at: timestamp.nullable(),
  locale: locale.nullable(),
  metadata,
  created_at: timestamp,
  updated_at: timestamp,
});
export type Customer = z.infer<typeof customer>;

// ── Discounts ────────────────────────────────────────────────────────────────

export const discountKind = z.enum(['percent', 'fixed', 'free_shipping']);
export type DiscountKind = z.infer<typeof discountKind>;

export const discountAppliesTo = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }),
  z.object({ type: z.literal('products'), product_ids: z.array(id).min(1) }),
  z.object({ type: z.literal('collections'), collection_ids: z.array(id).min(1) }),
]);
export type DiscountAppliesTo = z.infer<typeof discountAppliesTo>;

export const discountStatus = z.enum(['active', 'disabled']);

/**
 * `value` depends on `kind`:
 * - percent: basis points, 1000 = 10% (max 10000).
 * - fixed: minor units in the store currency, 5000 = $50.00.
 * - free_shipping: ignored, send 0.
 */
const discountFields = z.object({
  code: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[A-Z0-9_-]+$/, 'Uppercase letters, numbers, - and _ only')
    .nullable()
    .describe('Null = automatic discount (applied without a code).'),
  kind: discountKind,
  value: z.number().int().nonnegative(),
  applies_to: discountAppliesTo.default({ type: 'all' }),
  min_subtotal_amount: amount.nullable().default(null),
  usage_limit: z.number().int().positive().nullable().default(null),
  per_customer_limit: z.number().int().positive().nullable().default(null),
  starts_at: timestamp.nullable().default(null),
  ends_at: timestamp.nullable().default(null),
  status: discountStatus.default('active'),
});

function refineDiscount(
  d: { kind: DiscountKind; value: number; starts_at: string | null; ends_at: string | null },
  ctx: z.RefinementCtx,
) {
  if (d.kind === 'percent' && (d.value < 1 || d.value > 10_000)) {
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message: 'Percent discounts use basis points between 1 and 10000 (1000 = 10%).',
    });
  }
  if (d.kind === 'fixed' && d.value < 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message: 'Fixed discounts need a positive amount in minor units.',
    });
  }
  if (d.starts_at && d.ends_at && Date.parse(d.ends_at) <= Date.parse(d.starts_at)) {
    ctx.addIssue({
      code: 'custom',
      path: ['ends_at'],
      message: 'ends_at must be after starts_at.',
    });
  }
}

export const discountInput = discountFields.superRefine(refineDiscount);
export type DiscountInput = z.infer<typeof discountInput>;

/** Create (no `id`) or update (with `id`) a discount. Updates replace every field. */
export const discountUpsertInput = discountFields
  .extend({ id: id.optional() })
  .superRefine(refineDiscount);
export type DiscountUpsertInput = z.infer<typeof discountUpsertInput>;

export const discountView = discountFields.extend({
  id,
  usage_count: z.number().int(),
  created_at: timestamp,
  updated_at: timestamp,
});

// ── Carts ────────────────────────────────────────────────────────────────────

export const cartStatus = z.enum(['open', 'converted', 'abandoned', 'expired']);

export const bookingSlot = z.object({
  starts_at: timestamp.describe('A start time from GET /storefront/availability.'),
  resource_id: id.optional().describe('Pick a specific staff member/room; any free one otherwise.'),
});

export const cartItemInput = z.object({
  variant_id: id,
  quantity: z.number().int().positive().max(999),
  booking_slot: bookingSlot.optional(),
});
export type CartItemInput = z.infer<typeof cartItemInput>;

export const cart = z.object({
  id,
  token: z.string().min(20),
  customer_id: id.nullable(),
  email: email.nullable(),
  currency,
  status: cartStatus,
  expires_at: timestamp,
  recovered_at: timestamp.nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type Cart = z.infer<typeof cart>;

// ── Orders ───────────────────────────────────────────────────────────────────

export const orderStatus = z.enum(['pending_payment', 'open', 'completed', 'cancelled']);
export type OrderStatus = z.infer<typeof orderStatus>;

export const paymentStatus = z.enum([
  'unpaid',
  'partially_paid',
  'paid',
  'partially_refunded',
  'refunded',
]);
export type PaymentStatus = z.infer<typeof paymentStatus>;

export const fulfillmentStatus = z.enum(['unfulfilled', 'partially_fulfilled', 'fulfilled']);
export type FulfillmentStatus = z.infer<typeof fulfillmentStatus>;

export const orderChannel = z.enum([
  'web',
  'admin',
  'whatsapp',
  'google',
  'mercadolibre',
  'api',
  'agent',
]);

export const fulfillmentType = z.enum(['shipment', 'digital', 'booking', 'none']);

/** Every field is a snapshot copied at purchase time; never re-read from the catalog. */
export const orderItem = z.object({
  id,
  order_id: id,
  variant_id: id.nullable(),
  product_type: productType,
  title: z.string(),
  variant_title: z.string().nullable(),
  sku: z.string().nullable(),
  unit_price_amount: amount,
  quantity: z.number().int().positive(),
  discount_amount: amount,
  total_amount: amount,
  fulfillment_type: fulfillmentType,
  metadata,
});
export type OrderItem = z.infer<typeof orderItem>;

export const order = z.object({
  id,
  number: z.number().int().positive(),
  channel: orderChannel,
  customer_id: id.nullable(),
  email,
  phone: z.string().nullable(),
  currency,
  subtotal_amount: amount,
  discount_amount: amount,
  shipping_amount: amount,
  tax_amount: amount,
  total_amount: amount,
  amount_paid: amount,
  amount_refunded: amount,
  status: orderStatus,
  payment_status: paymentStatus,
  fulfillment_status: fulfillmentStatus,
  shipping_address: address.nullable(),
  billing_address: address.nullable(),
  notes: z.string().nullable(),
  placed_at: timestamp,
  cancelled_at: timestamp.nullable(),
  cancel_reason: z.string().nullable(),
  metadata,
  created_at: timestamp,
  updated_at: timestamp,
});
export type Order = z.infer<typeof order>;

// ── Payments ─────────────────────────────────────────────────────────────────

export const paymentMethod = z.enum([
  'card',
  'oxxo',
  'spei',
  'mercadopago',
  'paypal',
  'cash',
  'other',
]);
export type PaymentMethod = z.infer<typeof paymentMethod>;

export const payment = z.object({
  id,
  order_id: id,
  provider: z.string(),
  provider_payment_id: z.string().nullable(),
  method: paymentMethod,
  kind: z.enum(['charge', 'deposit', 'balance']),
  amount,
  currency,
  status: z.enum(['pending', 'succeeded', 'failed', 'expired']),
  created_at: timestamp,
});
export type Payment = z.infer<typeof payment>;

export const refundInput = z.object({
  amount: amount.refine((v) => v > 0, 'Refund amount must be positive'),
  reason: z.string().min(1).max(500),
  confirm: z
    .literal(true)
    .describe('Must be true. Refunds move real money; confirm with the owner first.'),
});
export type RefundInput = z.infer<typeof refundInput>;

/** Sale made outside the storefront (cash, transfer, WhatsApp), recorded by staff or an agent. */
export const manualOrderInput = z.object({
  email,
  phone: z.string().max(30).optional(),
  first_name: z.string().max(100).optional(),
  last_name: z.string().max(100).optional(),
  channel: z.enum(['admin', 'whatsapp', 'api', 'agent']).optional(),
  items: z
    .array(
      z.object({
        variant_id: id,
        quantity: z.number().int().min(1).max(999).default(1),
        unit_price_amount: amount
          .optional()
          .describe('Overrides the catalog price for this order only.'),
      }),
    )
    .min(1)
    .max(100),
  discount_codes: z.array(z.string().min(1).max(40)).max(5).optional(),
  shipping_amount: amount.default(0),
  shipping_address: address.optional(),
  note: z.string().max(2000).optional(),
  payment: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('paid'),
      method: z.enum(['cash', 'spei', 'card', 'other']),
      reference: z.string().max(200).optional(),
    }),
    z.object({
      mode: z.literal('link'),
      success_url: z.url().optional(),
    }),
  ]),
  notify_customer: z.boolean().default(true),
  confirm: z
    .boolean()
    .optional()
    .describe('Required (true) with payment.mode "paid": it records money received.'),
});
export type ManualOrderInput = z.infer<typeof manualOrderInput>;
